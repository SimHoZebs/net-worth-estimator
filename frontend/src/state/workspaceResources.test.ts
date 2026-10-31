import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { getUserScope } from "../auth/resourceScope.ts";
import {
	checkpointsOptions,
	getCheckpoints,
	getServerModel,
	modelOptions,
	reloadWorkspace,
	resolversOptions,
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
		const options = modelOptions();
		await Promise.all([
			serverQueryClient().fetchQuery(options),
			serverQueryClient().fetchQuery(options),
		]);
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).endsWith("/v1/financial-model"),
			),
		).toHaveLength(1);
		expect(getServerModel()?.revision).toBe("current");
		expect(getServerModel()).not.toHaveProperty("conversion");
		expect(typeof getServerModel()?.fingerprint).toBe("string");
	});
	it("removes server data from the Query cache", () => {
		setServerModelFixture();
		serverQueryClient().removeQueries({
			queryKey: userResourceKey("model"),
			exact: true,
		});
		expect(getServerModel()).toBeUndefined();
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
		const server = stubTestServer();
		server.setRevision("current");
		server.holdModel(pending);
		const options = modelOptions();
		const old = serverQueryClient()
			.fetchQuery(options)
			.catch((error: unknown) => error);
		await serverQueryClient().cancelQueries({ queryKey: options.queryKey });
		expect(await old).toBeInstanceOf(Error);
		await serverQueryClient().fetchQuery(options);
		finish(server.ok({ model: null, issues: [], revision: "retired" }));
		await Promise.resolve();
		expect(getServerModel()?.revision).toBe("current");
	});
	it("reports whether the scoped model fetch succeeded", async () => {
		const server = stubTestServer();
		expect(await reloadWorkspace()).toBe(true);
		server.failModelOnce(new Error("boom"));
		expect(await reloadWorkspace()).toBe(false);
	});
});
