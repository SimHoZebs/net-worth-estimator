import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { acceptTestResource } from "../mocks/resource.ts";
import { getUserScope } from "../auth/resourceScope.ts";
import { todayIso } from "../domain/format.ts";
import {
	balancesOptions,
	balancesQueryKey,
	checkpointsOptions,
	getAccountBalances,
	getCheckpoints,
	getPaymentTermsForAccount,
	getPaymentTermsList,
	paymentTermsOptions,
	purchasesOptions,
	reloadWorkspace,
	resolversOptions,
	statusOptions,
	useAccountBalances,
	userResourceKey,
} from "./workspaceResources.ts";
import { serverQueryClient, resetServerQueryCache } from "./serverQuery.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { fixtureModel } from "../mocks/model.ts";
import { modelFixture, stubTestServer } from "../mocks/waypointServer.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("direct Query ownership", () => {
	it("keys default balances to today and requests that UTC date", async () => {
		const server = stubTestServer();
		const options = balancesOptions();
		expect(options.queryKey).toEqual(balancesQueryKey());
		expect(options.queryKey.at(-1)).toBe(todayIso());
		await serverQueryClient().fetchQuery(options);
		const balanceCalls = server.fetcher.mock.calls.filter(([url]) =>
			String(url).startsWith("/v1/accounts/balances"),
		);
		expect(balanceCalls).toHaveLength(1);
		const url = new URL(String(balanceCalls[0]![0]), "http://localhost");
		expect(url.searchParams.get("asOf")).toBe(todayIso());
	});

	it("expires current-date balances at UTC midnight", async () => {
		const server = stubTestServer();
		const fetcher = server.fetcher;
		const cache = serverQueryClient();
		const options = balancesOptions();
		const updatedAt = Date.parse("2026-11-25T23:59:58Z");
		cache.setQueryData(
			options.queryKey,
			{ accounts: [], asOf: "2026-11-25", revision: "current" },
			{ updatedAt },
		);
		const now = vi.spyOn(Date, "now").mockReturnValue(updatedAt + 1_000);
		try {
			await cache.fetchQuery(options);
			expect(fetcher).not.toHaveBeenCalled();
			now.mockReturnValue(updatedAt + 2_000);
			await cache.fetchQuery(options);
			expect(fetcher).toHaveBeenCalledOnce();
		} finally {
			now.mockRestore();
		}
	});

	it("keeps explicit historical balance cuts deterministic", async () => {
		const server = stubTestServer();
		const options = balancesOptions(getUserScope(), "2026-01-31");
		await serverQueryClient().fetchQuery(options);
		await serverQueryClient().fetchQuery(options);
		expect(options.queryKey.at(-1)).toBe("2026-01-31");
		expect(
			server.fetcher.mock.calls.filter(([url]) =>
				String(url).startsWith("/v1/accounts/balances"),
			),
		).toHaveLength(1);
	});

	it("primes current balance rows with actual-only replay", () => {
		const model = modelFixture();
		model.checkpoints = [
			{
				AccountId: "cash",
				Balance: 100,
				observedAt: Date.parse("2026-01-01T10:00:00Z") / 1000,
			},
		];
		model.transactions = [
			{
				id: "actual",
				name: "Actual",
				sourceAccountId: "cash",
				destinations: null,
				amount: { resolver: "expression", config: { expression: "25" } },
				postedTime: Date.parse("2026-01-02T10:00:00Z") / 1000,
				transactionTime: Date.parse("2026-01-02T10:00:00Z") / 1000,
				enabled: true,
				source: "user",
				pending: false,
				void: false,
			} as (typeof model.transactions)[number],
		];
		setServerModelFixture(undefined, { model });
		expect(
			getAccountBalances()?.accounts.find((row) => row.id === "cash"),
		).toMatchObject({
			balance: 75,
			observedBalance: 100,
		});
	});

	it("does not refetch cached workspace data on remount", async () => {
		const server = stubTestServer();
		server.setRevision("current");
		const mounted = renderHook(() => useAccountBalances());
		await waitFor(() =>
			expect(mounted.result.current.data?.revision).toBe("current"),
		);
		expect(server.fetcher).toHaveBeenCalledOnce();
		mounted.unmount();

		const remounted = renderHook(() => useAccountBalances());
		expect(remounted.result.current.data?.revision).toBe("current");
		expect(remounted.result.current.isFetching).toBe(false);
		expect(server.fetcher).toHaveBeenCalledOnce();
		remounted.unmount();
	});

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
			fetcher.mock.calls.filter(([url]) => String(url).endsWith("/v1/status")),
		).toHaveLength(1);
		expect(
			serverQueryClient().getQueryData(userResourceKey("status")),
		).toMatchObject({
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
		expect(
			serverQueryClient().getQueryData(userResourceKey("status")),
		).toMatchObject({
			hasModel: true,
		});
	});
	it("reports whether the scoped status fetch succeeded", async () => {
		const server = stubTestServer();
		expect(await reloadWorkspace()).toBe(true);
		server.failStatusOnce(new Error("boom"));
		expect(await reloadWorkspace()).toBe(false);
	});
	it("completes observer-owned reads before balances can unmount their view", async () => {
		const server = stubTestServer();
		const respond = server.fetcher.getMockImplementation();
		if (!respond) throw new Error("fixture fetcher missing");
		let unsubscribe: (() => void) | undefined;
		let destroy: (() => void) | undefined;
		let unmounted = false;
		const events: string[] = [];
		server.fetcher.mockImplementation(async (...args) => {
			const url = new URL(String(args[0]), "http://test");
			if (url.pathname.endsWith("/v1/planned-purchases")) {
				events.push("purchases-start");
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			const response = await respond(...args);
			if (url.pathname.endsWith("/v1/planned-purchases"))
				events.push("purchases-end");
			if (url.pathname.endsWith("/v1/accounts/balances")) {
				events.push("balances");
				unmounted = true;
				destroy?.();
			}
			return response;
		});
		const observer = new QueryObserver(serverQueryClient(), {
			...purchasesOptions(getUserScope()),
			enabled: false,
		});
		unsubscribe = observer.subscribe(() => {});
		destroy = () => observer.destroy();
		try {
			events.length = 0;
			expect(await reloadWorkspace()).toBe(true);
			expect(events.indexOf("purchases-end")).toBeLessThan(
				events.indexOf("balances"),
			);
			expect(unmounted).toBe(true);
			expect(
				server.fetcher.mock.calls.filter(([url]) =>
					String(url).endsWith("/v1/planned-purchases"),
				),
			).toHaveLength(1);
		} finally {
			unsubscribe?.();
			destroy?.();
		}
	});
	it("loads payment terms from the canonical model read", async () => {
		const server = stubTestServer(undefined, {
			...fixtureModel(),
			paymentTerms: [
				{
					accountId: "loan",
					minimumFixed: 25,
					minimumPercent: 0.02,
					dueDay: 15,
				},
			],
		});
		server.setRevision("current");
		const list = await serverQueryClient().fetchQuery(paymentTermsOptions());
		expect(list.paymentTerms).toHaveLength(1);
		expect(list.revision).toBe("current");
		expect(getPaymentTermsList()?.paymentTerms).toEqual(list.paymentTerms);
		expect(getPaymentTermsForAccount("loan")).toMatchObject({
			minimumFixed: 25,
			minimumPercent: 0.02,
			dueDay: 15,
		});
		expect(getPaymentTermsForAccount("checking")).toBeNull();
	});
});
