import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../test/resource.ts";
import { setServerStatusFixture } from "../test/workspace.ts";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import type { RemoteApiClient } from "./workspaceStore.ts";
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
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
});
function client(lastSyncAt = "after") {
	return {
		getStatus: vi.fn(async () => ({ readOnly: false, lastSyncAt })),
		getModel: vi.fn(async () => ({ document: null, issues: [] })),
		listAmountPresets: vi.fn(async () => ({ presets: [] })),
	};
}

it("refreshes the model and invalidates only the current resource's financial calculations", async () => {
	const api = client();
	const key = deterministicQueryKey("document", 10);
	serverQueryClient().setQueryData(key, "result");
	serverQueryClient().setQueryData(["unrelated"], "keep");
	renderHook(() => useWorkspaceSyncMonitor(api as unknown as RemoteApiClient));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(api.getModel).toHaveBeenCalledOnce());
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
	expect(serverQueryClient().getQueryState(["unrelated"])?.isInvalidated).toBe(
		false,
	);
});

it("does not reload an unchanged model", async () => {
	const api = client("before");
	renderHook(() => useWorkspaceSyncMonitor(api as unknown as RemoteApiClient));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	await waitFor(() => expect(api.getStatus).toHaveBeenCalledOnce());
	expect(api.getModel).not.toHaveBeenCalled();
});

it("does not poll while Query owns a pending model mutation", async () => {
	const api = client();
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
	renderHook(() => useWorkspaceSyncMonitor(api as unknown as RemoteApiClient));
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	expect(api.getStatus).not.toHaveBeenCalled();
	finish();
	await pending;
});
