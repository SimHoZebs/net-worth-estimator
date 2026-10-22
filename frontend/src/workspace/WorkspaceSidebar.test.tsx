// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerStatus } from "../api/index.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { WorkspaceSidebar } from "./WorkspaceSidebar.tsx";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));

const baseStatus: ServerStatus = { readOnly: false, authEnabled: false };
const lastSyncAt = "2026-10-18T14:30:00Z";

function renderSidebar(pending = false) {
	return render(
		<WorkspaceSidebar page="outlook" onClose={() => {}} pending={pending} />,
	);
}

function localSyncTime(value: string) {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));
}

describe("sidebar sync signals", () => {
	beforeEach(() => resetWorkspaceStore());
	afterEach(() => {
		cleanup();
		resetWorkspaceStore();
	});

	it("shows the server's last successful sync in browser-local time, including read-only mode", () => {
		useWorkspaceStore.setState({
			status: {
				...baseStatus,
				readOnly: true,
				syncConfigured: true,
				lastSyncAt,
			},
		});
		const view = renderSidebar();
		expect(
			view.getByText(`Last synced ${localSyncTime(lastSyncAt)}`),
		).toBeTruthy();
		expect(view.container.querySelector("time")?.dateTime).toBe(lastSyncAt);
		expect(view.queryByRole("button", { name: /sync/i })).toBeNull();
	});

	it.each([
		[null, "Sync status unavailable"],
		[baseStatus, "Sync status unavailable"],
		[{ ...baseStatus, syncConfigured: false }, "Sync not configured"],
		[{ ...baseStatus, syncConfigured: true }, "Never synced"],
		[
			{ ...baseStatus, syncConfigured: true, lastSyncAt: "not-a-time" },
			"Sync time unavailable",
		],
	] satisfies [ServerStatus | null, string][])(
		"renders honest sync state for %j",
		(status, label) => {
			useWorkspaceStore.setState({ status });
			const view = renderSidebar();
			expect(view.getByText(label)).toBeTruthy();
			expect(view.container.querySelector("time")).toBeNull();
		},
	);

	it("preserves a recorded sync time when sync is no longer configured", () => {
		useWorkspaceStore.setState({
			status: { ...baseStatus, syncConfigured: false, lastSyncAt },
		});
		const view = renderSidebar();
		expect(
			view.getByText(`Last synced ${localSyncTime(lastSyncAt)}`),
		).toBeTruthy();
	});

	it("updates the timestamp when server status changes", () => {
		useWorkspaceStore.setState({
			status: { ...baseStatus, syncConfigured: true },
		});
		const view = renderSidebar();
		expect(view.getByText("Never synced")).toBeTruthy();
		act(() => {
			useWorkspaceStore.setState({
				status: { ...baseStatus, syncConfigured: true, lastSyncAt },
			});
		});
		expect(
			view.getByText(`Last synced ${localSyncTime(lastSyncAt)}`),
		).toBeTruthy();
		expect(view.queryByText("Never synced")).toBeNull();
	});

	it("defers sync copy until the sidebar finishes loading", () => {
		const view = renderSidebar(true);
		expect(view.queryByText(/synced|sync status/i)).toBeNull();
	});
});
