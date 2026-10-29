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
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

function stubSync(lastSyncAt = "after") {
	const fetcher = vi.fn(async (url: unknown, _init?: RequestInit) => {
		const headers = new Headers({ "content-type": "application/json" });
		const resource = getUserScope().resource?.id;
		if (resource) headers.set("Waypoint-Resource", resource);
		const path = String(url);
		if (path.endsWith("/v1/status"))
			return new Response(JSON.stringify({ readOnly: false, lastSyncAt }), {
				headers,
			});
		return new Response(
			JSON.stringify({ document: null, issues: [], revision: "r1" }),
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
	vi.unstubAllGlobals();
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: "visible",
	});
	setServerStatusFixture({ readOnly: false, lastSyncAt: "before" });
});
afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("refreshes the model and invalidates only the current resource's financial calculations", async () => {
	const fetcher = stubSync();
	const key = deterministicQueryKey("document", 10);
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

it("re-arms the poll after a user switch", async () => {
	const fetcher = stubSync();
	const nextId = `users/${"b".repeat(64)}`;
	const rendered = renderHook(() => useWorkspaceSyncMonitor(true));
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: nextId,
				kind: "private",
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
