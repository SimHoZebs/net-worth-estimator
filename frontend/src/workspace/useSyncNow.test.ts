// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiHttpError } from "../api/index.ts";
import type { ServerStatus, SimpleFINSummary } from "../api/index.ts";
import { resetUiStore, useUiStore } from "../state/uiStore.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
	type RemoteApiClient,
} from "../state/workspaceStore.ts";
import { useSyncNow } from "./useSyncNow.ts";

const summary = {
	checkpointsInserted: 1,
	checkpointsUpdated: 0,
	checkpointsSkipped: 0,
	pendingDeleted: 0,
	pendingInserted: 0,
	accountsProvisioned: 0,
	skipped: {},
	dryRun: false,
} as SimpleFINSummary;

function bindStatusClient(status: ServerStatus) {
	const getStatus = vi.fn(async () => status);
	useWorkspaceStore
		.getState()
		.bindEngine({ getStatus } as unknown as RemoteApiClient, "");
	return getStatus;
}

describe("useSyncNow", () => {
	it("refreshes status after a successful trigger", async () => {
		resetWorkspaceStore();
		resetUiStore();
		useUiStore.setState({ authToken: "tab-token" });
		const refreshed: ServerStatus = {
			readOnly: false,
			authEnabled: false,
			syncConfigured: true,
			lastSyncAt: "2026-10-19T12:30:00Z",
		};
		const getStatus = bindStatusClient(refreshed);
		const triggerSimpleFIN = vi.fn(async () => summary);
		const rendered = renderHook(() =>
			useSyncNow({ client: { triggerSimpleFIN } }),
		);
		let ok = false;
		await act(async () => {
			ok = await rendered.result.current.syncNow();
		});
		expect(ok).toBe(true);
		expect(triggerSimpleFIN).toHaveBeenCalledWith({
			authToken: "tab-token",
		});
		expect(getStatus).toHaveBeenCalledTimes(1);
		expect(useWorkspaceStore.getState().status).toEqual(refreshed);
		expect(rendered.result.current).toMatchObject({
			syncing: false,
			error: null,
		});
		rendered.unmount();
	});

	it("reports trigger failures inline without refreshing", async () => {
		resetWorkspaceStore();
		resetUiStore();
		const getStatus = bindStatusClient({
			readOnly: false,
			authEnabled: false,
			syncConfigured: true,
		});
		const triggerSimpleFIN = vi.fn(
			async () =>
				new ApiHttpError({ message: "The server is busy.", status: 409 }),
		);
		const rendered = renderHook(() =>
			useSyncNow({ client: { triggerSimpleFIN } }),
		);
		let ok = true;
		await act(async () => {
			ok = await rendered.result.current.syncNow();
		});
		expect(ok).toBe(false);
		expect(rendered.result.current.error).toBe("The server is busy.");
		expect(getStatus).not.toHaveBeenCalled();
		rendered.unmount();
	});

	it("ignores a second press while a sync is in flight", async () => {
		resetWorkspaceStore();
		resetUiStore();
		bindStatusClient({
			readOnly: false,
			authEnabled: false,
			syncConfigured: true,
		});
		let release!: (value: Error | SimpleFINSummary) => void;
		const gate = new Promise<Error | SimpleFINSummary>((resolve) => {
			release = resolve;
		});
		const triggerSimpleFIN = vi.fn(async () => gate);
		const rendered = renderHook(() =>
			useSyncNow({ client: { triggerSimpleFIN } }),
		);
		let first!: Promise<boolean>;
		act(() => {
			first = rendered.result.current.syncNow();
		});
		let second = true;
		await act(async () => {
			second = await rendered.result.current.syncNow();
		});
		expect(second).toBe(false);
		expect(triggerSimpleFIN).toHaveBeenCalledTimes(1);
		await act(async () => {
			release(summary);
			expect(await first).toBe(true);
		});
		rendered.unmount();
	});
});
