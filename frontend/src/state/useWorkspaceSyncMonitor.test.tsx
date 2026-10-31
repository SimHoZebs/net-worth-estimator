import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerStatusFixture } from "../mocks/workspace.ts";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
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
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

const status = {
	readOnly: false,
	syncConfigured: true,
	syncQuotaUsed: 0,
	syncQuotaLimit: 24,
};

function stubSync(lastSyncAt = "after") {
	const fetcher = vi.fn(async (url: unknown, _init?: RequestInit) => {
		const headers = new Headers({ "content-type": "application/json" });
		const resource = getUserScope().resource?.id;
		if (resource) headers.set("Waypoint-Resource", resource);
		const path = String(url);
		if (path.endsWith("/v1/status"))
			return new Response(JSON.stringify({ ...status, lastSyncAt }), {
				headers,
			});
		return new Response(
			JSON.stringify({ model: null, issues: [], revision: "r1" }),
			{ headers },
		);
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

function statusFetches(fetcher: ReturnType<typeof vi.fn>) {
	return fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/v1/status"),
	);
}

function modelFetches(fetcher: ReturnType<typeof vi.fn>) {
	return fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/v1/financial-model"),
	);
}

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	resetSyncWorkspaceRefresh();
	vi.unstubAllGlobals();
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	setServerStatusFixture({ ...status, lastSyncAt: "before" });
});
afterEach(() => {
	cleanup();
	resetServerQueryCache();
	resetSyncWorkspaceRefresh();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("refreshes the model and invalidates only the current resource's financial calculations", async () => {
	const fetcher = stubSync();
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	serverQueryClient().setQueryData(["unrelated"], "keep");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(modelFetches(fetcher)).toHaveLength(1));
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
	expect(modelFetches(fetcher)).toHaveLength(0);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("retries a sync whose model reload failed", async () => {
	const headers = () => {
		const responseHeaders = new Headers({
			"content-type": "application/json",
		});
		const resource = getUserScope().resource?.id;
		if (resource) responseHeaders.set("Waypoint-Resource", resource);
		return responseHeaders;
	};
	let modelCalls = 0;
	const fetcher = vi.fn(async (url: unknown) => {
		const path = String(url);
		if (path.endsWith("/v1/status"))
			return new Response(JSON.stringify({ ...status, lastSyncAt: "after" }), {
				headers: headers(),
			});
		if (path.endsWith("/v1/financial-model")) {
			modelCalls += 1;
			if (modelCalls === 1)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: headers(),
				});
		}
		return new Response(
			JSON.stringify({ model: null, issues: [], revision: "r1" }),
			{ headers: headers() },
		);
	});
	vi.stubGlobal("fetch", fetcher);
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	// The status moved but the model reload failed: the stamp stays unapplied
	// and the financial calculation is left alone for the retry.
	await waitFor(() => expect(modelCalls).toBe(1));
	await waitFor(() => expect(serverQueryClient().isFetching()).toBe(0));
	expect(getAppliedSyncStamp(getUserScope())).toBe("before");
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(modelCalls).toBe(2));
	await waitFor(() =>
		expect(getAppliedSyncStamp(getUserScope())).toBe("after"),
	);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
});

it("retains a detected sync while the workspace is busy", async () => {
	const headers = () => {
		const responseHeaders = new Headers({
			"content-type": "application/json",
		});
		const resource = getUserScope().resource?.id;
		if (resource) responseHeaders.set("Waypoint-Resource", resource);
		return responseHeaders;
	};
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
			return new Response(JSON.stringify({ ...status, lastSyncAt: "after" }), {
				headers: headers(),
			});
		}
		return new Response(
			JSON.stringify({ model: null, issues: [], revision: "r1" }),
			{ headers: headers() },
		);
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
	resolveStatus(
		new Response(JSON.stringify({ ...status, lastSyncAt: "after" }), {
			headers: headers(),
		}),
	);
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
	expect(modelFetches(fetcher)).toHaveLength(0);
	finish();
	await pending;
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(modelFetches(fetcher)).toHaveLength(1));
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

it("does not reload an unchanged model", async () => {
	const fetcher = stubSync("before");
	renderHook(() => useWorkspaceSyncMonitor(true));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(statusFetches(fetcher)).toHaveLength(1));
	expect(modelFetches(fetcher)).toHaveLength(0);
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
