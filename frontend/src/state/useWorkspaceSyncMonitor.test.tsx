import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../mocks/fetch.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { setupQueryScope, teardownQueryScope } from "../mocks/testScope.tsx";
import { setServerStatusFixture } from "../mocks/workspace.ts";
import { deterministicQueryKey, serverQueryClient } from "./serverQuery.ts";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	getAppliedSyncStamp,
	markSyncApplied,
	resetSyncWorkspaceRefresh,
} from "./syncWorkspaceRefresh.ts";
import { userResourceKey } from "./workspaceResources.ts";
import { syncLinksKey } from "./syncSettings.ts";
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

const status = {
	readOnly: false,
	hasModel: true,
	syncConfigured: true,
	syncQuotaUsed: 0,
	syncQuotaLimit: 24,
};

function stubSync(lastSyncAt = "after") {
	const fetcher = vi.fn(async (url: unknown, _init?: RequestInit) => {
		const path = String(url);
		if (path.endsWith("/v1/status")) return ok({ ...status, lastSyncAt });
		if (path.includes("/accounts/balances")) return ok({ accounts: [], asOf: "2026-10-26", revision: "r1" });
		if (path.startsWith("/v1/checkpoints")) return ok({ checkpoints: [], revision: "r1" });
		if (path.startsWith("/v1/schedules")) return ok({ schedules: [], revision: "r1" });
		if (path.startsWith("/v1/transactions/catalog")) return ok({ items: [], revision: "r1" });
		if (path.startsWith("/v1/transactions")) return ok({ transactions: [], revision: "r1" });
		if (path.includes("/evaluations/summary")) return ok({ evaluations: { financialIndependence: [], netWorthThreshold: [], accountBalance: [], transactionFulfillment: [], cycleFulfillment: [], plannedPurchases: [] }, revision: "r1" });
		if (path.includes("/amount-presets")) return ok({ presets: [] });
		if (path.includes("/planned-purchases")) return ok({ plannedPurchases: [], revision: "r1" });
		return ok({ model: null, issues: [], revision: "r1" });
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

function statusFetches(fetcher: ReturnType<typeof vi.fn>) {
	return fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/v1/status"),
	);
}

beforeEach(() => {
	setupQueryScope();
	resetSyncWorkspaceRefresh();
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	setServerStatusFixture({ ...status, lastSyncAt: "before" });
});
afterEach(() => {
	teardownQueryScope();
	resetSyncWorkspaceRefresh();
	vi.restoreAllMocks();
});

it("refreshes the workspace rows and invalidates only the current resource's financial calculations", async () => {
	const fetcher = stubSync();
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	serverQueryClient().setQueryData(["unrelated"], "keep");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).startsWith("/v1/checkpoints"),
			),
		).toHaveLength(1),
	);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
	expect(serverQueryClient().getQueryState(["unrelated"])?.isInvalidated).toBe(
		false,
	);
});

it("does not reload after an explicit sync refresh already applied the stamp", async () => {
	// A manual sync's explicit refresh landed "after" in the status cache and
	// marked it applied before the monitor polls: the polls must not reload.
	setServerStatusFixture({ ...status, lastSyncAt: "after" });
	markSyncApplied(getUserScope(), "after");
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	const fetcher = stubSync("after");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(2));
	expect(
		fetcher.mock.calls.filter(([url]) =>
			String(url).startsWith("/v1/checkpoints"),
		),
	).toHaveLength(0);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("retries a sync whose workspace reload failed", async () => {
	let checkpointCalls = 0;
	const fetcher = vi.fn(async (url: unknown) => {
		const path = String(url);
		if (path.endsWith("/v1/status")) return ok({ ...status, lastSyncAt: "after" });
		if (path.includes("/accounts/balances")) return ok({ accounts: [], asOf: "2026-10-26", revision: "r1" });
		if (path.startsWith("/v1/checkpoints")) {
			checkpointCalls += 1;
			if (checkpointCalls === 1)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			return ok({ checkpoints: [], revision: "r1" });
		}
		if (path.startsWith("/v1/schedules")) return ok({ schedules: [], revision: "r1" });
		if (path.startsWith("/v1/transactions/catalog")) return ok({ items: [], revision: "r1" });
		if (path.startsWith("/v1/transactions")) return ok({ transactions: [], revision: "r1" });
		if (path.includes("/evaluations/summary")) return ok({ evaluations: { financialIndependence: [], netWorthThreshold: [], accountBalance: [], transactionFulfillment: [], cycleFulfillment: [], plannedPurchases: [] }, revision: "r1" });
		if (path.includes("/amount-presets")) return ok({ presets: [] });
		if (path.includes("/planned-purchases")) return ok({ plannedPurchases: [], revision: "r1" });
		return ok({ model: null, issues: [], revision: "r1" });
	});
	vi.stubGlobal("fetch", fetcher);
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	// Status succeeded; the required checkpoints row failed during reload.
	// The stamp stays unapplied and the calculation is left alone for retry.
	await waitFor(() => expect(checkpointCalls).toBe(1));
	await waitFor(() => expect(serverQueryClient().isFetching()).toBe(0));
	expect(getAppliedSyncStamp(getUserScope())).toBe("before");
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(checkpointCalls).toBe(2));
	await waitFor(() =>
		expect(getAppliedSyncStamp(getUserScope())).toBe("after"),
	);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
});

it("retains a detected sync while the workspace is busy", async () => {
	let resolveStatus!: (value: Response) => void;
	const statusGate = new Promise<Response>((resolve) => {
		resolveStatus = resolve;
	});
	let statusCalls = 0;
	const fetcher = vi.fn(async (url: unknown) => {
		const path = String(url);
		if (path.endsWith("/v1/status")) {
			statusCalls += 1;
			if (statusCalls === 1) return statusGate;
			return ok({ ...status, lastSyncAt: "after" });
		}
		if (path.includes("/accounts/balances")) return ok({ accounts: [], asOf: "2026-10-26", revision: "r1" });
		if (path.startsWith("/v1/checkpoints")) return ok({ checkpoints: [], revision: "r1" });
		if (path.startsWith("/v1/schedules")) return ok({ schedules: [], revision: "r1" });
		if (path.startsWith("/v1/transactions/catalog")) return ok({ items: [], revision: "r1" });
		if (path.startsWith("/v1/transactions")) return ok({ transactions: [], revision: "r1" });
		if (path.includes("/evaluations/summary")) return ok({ evaluations: { financialIndependence: [], netWorthThreshold: [], accountBalance: [], transactionFulfillment: [], cycleFulfillment: [], plannedPurchases: [] }, revision: "r1" });
		if (path.includes("/amount-presets")) return ok({ presets: [] });
		if (path.includes("/planned-purchases")) return ok({ plannedPurchases: [], revision: "r1" });
		return ok({ model: null, issues: [], revision: "r1" });
	});
	vi.stubGlobal("fetch", fetcher);
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusCalls).toBe(1));
	// A save starts while the status poll is in flight.
	const cache = serverQueryClient();
	const scope = getUserScope();
	let finish!: () => void;
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: ["workspace-write", scope.key, "model"],
		mutationFn: () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	});
	const pending = mutation.execute(undefined);
	await waitFor(() => expect(finish).toBeDefined());
	resolveStatus(ok({ ...status, lastSyncAt: "after" }));
	// The poll completes against the shared cache, but the workspace is busy,
	// so the change is retained instead of applied or consumed.
	await waitFor(() =>
		expect(
			serverQueryClient().getQueryData<{ lastSyncAt?: string }>(
				userResourceKey("status"),
			)?.lastSyncAt,
		).toBe("after"),
	);
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	expect(
		fetcher.mock.calls.filter(([url]) =>
			String(url).startsWith("/v1/checkpoints"),
		),
	).toHaveLength(0);
	finish();
	await pending;
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(2));
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).startsWith("/v1/checkpoints"),
			),
		).toHaveLength(1),
	);
});

it("follows a user switch without a caller rerender", async () => {
	const fetcher = stubSync();
	const nextId = `users/${"c".repeat(64)}`;
	const rendered = renderHook(() => useWorkspaceSyncMonitor(true));
	// No rerender of the caller: the subscription alone must re-arm the poll.
	act(() => {
		acceptUserScope(
			{
				apiBaseUrl: canonicalApiBaseUrl(""),
				resource: {
					id: nextId,
					permissions: ["user:read", "user:write", "user:project"],
				},
				subject: nextId,
			},
			suspendUserScope(),
		);
	});
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(
				([url, init]) =>
					String(url).endsWith("/v1/status") &&
					new Headers(init?.headers).get("Waypoint-Resource") === nextId,
			),
		).toHaveLength(1),
	);
	rendered.unmount();
});

it("re-arms the poll after a user switch", async () => {
	const fetcher = stubSync();
	const nextId = `users/${"b".repeat(64)}`;
	const rendered = renderHook(() => useWorkspaceSyncMonitor(true));
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: nextId,
				permissions: ["user:read", "user:write", "user:project"],
			},
			subject: nextId,
		},
		suspendUserScope(),
	);
	rendered.rerender();
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(
				([url, init]) =>
					String(url).endsWith("/v1/status") &&
					new Headers(init?.headers).get("Waypoint-Resource") === nextId,
			),
		).toHaveLength(1),
	);
	rendered.unmount();
});

it("refreshes sync links after a scheduled sync provisions accounts", async () => {
	const fetcher = stubSync("after");
	const cache = serverQueryClient();
	const scope = getUserScope();
	// Seed a links snapshot: the monitor must invalidate it once the new
	// stamp is applied so newly provisioned bank accounts appear.
	cache.setQueryData(syncLinksKey(scope), []);
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	await waitFor(() =>
		expect(cache.getQueryState(syncLinksKey(scope))?.isInvalidated).toBe(
			true,
		),
	);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("does not reload an unchanged workspace", async () => {
	const fetcher = stubSync("before");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	expect(
		fetcher.mock.calls.filter(([url]) =>
			String(url).startsWith("/v1/checkpoints"),
		),
	).toHaveLength(0);
});

it("does not poll while Query owns a pending model mutation", async () => {
	const fetcher = stubSync();
	const cache = serverQueryClient();
	let finish!: () => void;
	const scope = acceptTestResource()!;
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: ["workspace-write", scope.key, "model"],
		mutationFn: () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	});
	const pending = mutation.execute(undefined);
	await waitFor(() => expect(finish).toBeDefined());
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await Promise.resolve();
	await Promise.resolve();
	expect(statusFetches(fetcher)).toHaveLength(0);
	finish();
	await pending;
});
