import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";
import {
	type RemoteApiClient,
	resetWorkspaceStore,
	useWorkspaceStore,
} from "./workspaceStore.ts";

const initial = "2026-10-25T01:00:00Z";
const updated = "2026-10-25T07:00:00Z";
const originalHydrate = useWorkspaceStore.getState().hydrate;
let getStatus: ReturnType<typeof vi.fn>;
let hydrate: ReturnType<typeof vi.fn<typeof originalHydrate>>;
let api: RemoteApiClient;

beforeEach(() => {
	vi.useFakeTimers();
	acceptResourceScope(
		{
			apiBaseUrl: "https://plan.example",
			resource: {
				id: "a",
				kind: "private",
				permissions: ["plan:read", "plan:project"],
			},
			subject: "a",
		},
		suspendResourceScope(),
	);
	getStatus = vi.fn().mockResolvedValue({ lastSyncAt: initial });
	hydrate = vi.fn<typeof originalHydrate>().mockResolvedValue(undefined);
	api = { getStatus } as unknown as RemoteApiClient;
	useWorkspaceStore.setState({
		workspace: {} as never,
		status: { lastSyncAt: initial } as never,
		hydrate,
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
	resetWorkspaceStore();
	useWorkspaceStore.setState({ hydrate: originalHydrate });
	resetServerQueryCache();
	suspendResourceScope();
});

async function minute() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});
}

it("polls only status and keeps unchanged financial data fresh", async () => {
	const key = deterministicQueryKey("document", 10);
	serverQueryClient().setQueryData(key, "result");
	renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	expect(getStatus).toHaveBeenCalledOnce();
	expect(hydrate).not.toHaveBeenCalled();
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
});

it("invalidates financial results only for this resource and reloads on a changed sync", async () => {
	getStatus.mockResolvedValue({ lastSyncAt: updated });
	hydrate.mockImplementation(async () => {
		useWorkspaceStore.setState({ status: { lastSyncAt: updated } as never });
	});
	const key = deterministicQueryKey("document", 10);
	const other = ["deterministic-projection", "other", "document", 10];
	const unrelated = ["session"];
	for (const entry of [key, other, unrelated])
		serverQueryClient().setQueryData(entry, "result");
	renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	expect(hydrate).toHaveBeenCalledWith({ background: true });
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
	expect(serverQueryClient().getQueryState(other)?.isInvalidated).toBe(false);
	expect(serverQueryClient().getQueryState(unrelated)?.isInvalidated).toBe(
		false,
	);
	await minute();
	expect(hydrate).toHaveBeenCalledOnce();
});

it("does not overlap slow status checks", async () => {
	getStatus.mockImplementation(() => new Promise(() => {}));
	const hook = renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	await minute();
	expect(getStatus).toHaveBeenCalledOnce();
	const signal = getStatus.mock.calls[0]![0].signal as AbortSignal;
	hook.unmount();
	expect(signal.aborted).toBe(true);
});

it("retries next minute if a save starts during cache invalidation", async () => {
	getStatus.mockResolvedValue({ lastSyncAt: updated });
	vi.spyOn(serverQueryClient(), "invalidateQueries").mockImplementationOnce(
		async () => {
			useWorkspaceStore.getState().engine.saving = true;
		},
	);
	renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	expect(hydrate).not.toHaveBeenCalled();
	useWorkspaceStore.getState().engine.saving = false;
	await minute();
	expect(hydrate).toHaveBeenCalledWith({ background: true });
});

it("retains data after status failures and retries next minute", async () => {
	getStatus
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue({ lastSyncAt: updated });
	renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	expect(hydrate).not.toHaveBeenCalled();
	await minute();
	expect(hydrate).toHaveBeenCalledOnce();
});

it("checks immediately on reconnect and stops after unmount", async () => {
	const hook = renderHook(() => useWorkspaceSyncMonitor(api));
	await act(async () => {
		window.dispatchEvent(new Event("online"));
	});
	expect(getStatus).toHaveBeenCalledOnce();
	hook.unmount();
	await minute();
	expect(getStatus).toHaveBeenCalledOnce();
});

it("ignores late status responses after resource verification changes", async () => {
	let resolve!: (value: unknown) => void;
	getStatus.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	renderHook(() => useWorkspaceSyncMonitor(api));
	await minute();
	suspendResourceScope();
	await act(async () => {
		resolve({ lastSyncAt: updated });
	});
	expect(hydrate).not.toHaveBeenCalled();
});
