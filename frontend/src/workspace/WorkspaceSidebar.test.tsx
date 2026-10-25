// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerStatus } from "../api/index.ts";
import { SessionContext, type Session } from "../auth/sessionContext.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { WorkspaceSidebar } from "./WorkspaceSidebar.tsx";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));

const baseStatus: ServerStatus = { readOnly: false };
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

describe("sidebar account placement", () => {
	afterEach(cleanup);

	function renderSession(session: Session) {
		return render(
			<SessionContext
				value={{
					session,
					logout: vi.fn(async () => {}),
					logoutPending: false,
				}}
			>
				<aside aria-label="Workspace navigation">
					<WorkspaceSidebar page="outlook" onClose={() => {}} />
				</aside>
			</SessionContext>,
		);
	}

	it("places signed-in user info and account actions above navigation", () => {
		const view = renderSession({
			enabled: true,
			authenticated: true,
			allowed: true,
			accountURL: "https://identity.example/account",
			resource: {
				id: `plans/${"a".repeat(64)}`,
				kind: "private",
				permissions: ["plan:read", "plan:write"],
			},
			user: { subject: "editor", name: "Sam Lee" },
		});
		const sidebar = view.getByRole("complementary", {
			name: "Workspace navigation",
		});
		const navigation = view.getByRole("navigation", {
			name: "Main navigation",
		});
		for (const control of [
			view.getByText("Sam Lee"),
			view.getByRole("link", { name: "Account settings" }),
			view.getByRole("button", { name: "Sign out" }),
		]) {
			expect(sidebar.contains(control)).toBe(true);
			expect(navigation.contains(control)).toBe(false);
			expect(
				control.compareDocumentPosition(navigation) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}
		expect(view.queryByRole("combobox")).toBeNull();
		expect(view.queryByText("Editor")).toBeNull();
	});

	it("places the allowed guest preview and sign-in action above navigation", () => {
		const view = renderSession({
			enabled: true,
			authenticated: false,
			allowed: true,
			resource: {
				id: "plans/sample",
				kind: "sample",
				permissions: ["plan:read", "plan:project"],
			},
			user: { subject: "", name: "" },
		});
		const navigation = view.getByRole("navigation", {
			name: "Main navigation",
		});
		expect(view.getByText("Guest")).toBeTruthy();
		expect(view.getByText("Read-only preview")).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: "Sign in" })
				.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(view.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(view.queryByText("Account settings")).toBeNull();
	});
});
