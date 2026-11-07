import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { getUserScope } from "../auth/resourceScope.ts";
import {
	checkpointsOptions,
	getAccountBalances,
	getCheckpoints,
	reloadWorkspace,
	resolversOptions,
	statusOptions,
	userResourceKey,
} from "./workspaceResources.ts";
import { serverQueryClient, resetServerQueryCache } from "./serverQuery.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("direct Query ownership", () => {
	it("deduplicates and caches resolver discovery through the generated client", async () => {
		const server = stubTestServer();
		const data = {
			resolvers: [{ name: "fixed", description: "Fixed amount" }],
			providers: [],
		};
		const fetcher = vi.fn(async () => server.ok(data));
		vi.stubGlobal("fetch", fetcher);
		const options = resolversOptions();
		const results = await Promise.all([
			serverQueryClient().fetchQuery(options),
			serverQueryClient().fetchQuery(options),
		]);
		expect(results).toEqual([data, data]);
		expect(await serverQueryClient().fetchQuery(options)).toEqual(data);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledWith(
			"/v1/amount-resolvers",
			expect.objectContaining({
				method: "GET",
				signal: expect.any(AbortSignal),
			}),
		);
	});
	it("deduplicates reads without a workspace request engine", async () => {
		const server = stubTestServer();
		server.setRevision("current");
		const fetcher = server.fetcher;
		const options = statusOptions();
		await Promise.all([
			serverQueryClient().fetchQuery(options),
			serverQueryClient().fetchQuery(options),
		]);
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).endsWith("/v1/status"),
			),
		).toHaveLength(1);
		expect(serverQueryClient().getQueryData(userResourceKey("status"))).toMatchObject({
			hasModel: true,
		});
	});
	it("removes server data from the Query cache", () => {
		setServerModelFixture();
		serverQueryClient().removeQueries({
			queryKey: userResourceKey("balances"),
			exact: false,
		});
		expect(getAccountBalances()).toBeUndefined();
	});
	it("lists checkpoints through the narrow query with account filters", async () => {
		const server = stubTestServer();
		server.setRevision("current");
		const all = await serverQueryClient().fetchQuery(checkpointsOptions());
		expect(all.checkpoints).toHaveLength(2);
		expect(all.revision).toBe("current");
		const cash = await serverQueryClient().fetchQuery(
			checkpointsOptions(getUserScope(), { accountId: "cash" }),
		);
		expect(cash.checkpoints).toHaveLength(1);
		expect(cash.checkpoints[0]).toMatchObject({
			AccountId: "cash",
			Balance: 100,
		});
		expect(getCheckpoints()).toEqual(all);
		expect(getCheckpoints(getUserScope(), { accountId: "cash" })).toEqual(cash);
		const fetcher = server.fetcher;
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).startsWith("/v1/checkpoints"),
			),
		).toHaveLength(2);
	});
	it("does not let a canceled request overwrite a newer same-resource result", async () => {
		let finish!: (value: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			finish = resolve;
		});
		const headers = new Headers({ "content-type": "application/json" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				if (String(url).endsWith("/v1/status")) return pending;
				return new Response(JSON.stringify({}), { headers });
			}),
		);
		const options = statusOptions();
		const old = serverQueryClient()
			.fetchQuery(options)
			.catch((error: unknown) => error);
		await serverQueryClient().cancelQueries({ queryKey: options.queryKey });
		expect(await old).toBeInstanceOf(Error);
		vi.unstubAllGlobals();
		const server = stubTestServer();
		server.setRevision("current");
		await serverQueryClient().fetchQuery(options);
		finish(
			new Response(
				JSON.stringify({
					readOnly: false,
					hasModel: true,
					syncConfigured: false,
					syncQuotaUsed: 0,
					syncQuotaLimit: 0,
				}),
				{ headers },
			),
		);
		await Promise.resolve();
		expect(serverQueryClient().getQueryData(userResourceKey("status"))).toMatchObject({
			hasModel: true,
		});
	});
	it("reports whether the scoped status fetch succeeded", async () => {
		const server = stubTestServer();
		expect(await reloadWorkspace()).toBe(true);
		server.failStatusOnce(new Error("boom"));
		expect(await reloadWorkspace()).toBe(false);
	});
});
