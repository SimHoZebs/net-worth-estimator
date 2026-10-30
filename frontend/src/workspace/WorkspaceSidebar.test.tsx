// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerStatus } from "../api/index.ts";
import { SessionContext, type Session } from "../auth/sessionContext.ts";
import {
	resetNotifications,
	useNotifications,
} from "../state/notifications.ts";
import { WorkspaceSidebar } from "./WorkspaceSidebar.tsx";
import { isSyncStale, LastSync, SYNC_STALE_AFTER_MS } from "./LastSync.tsx";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerStatusFixture } from "../mocks/workspace.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));

const baseStatus: ServerStatus = {
	readOnly: false,
	syncConfigured: false,
	syncQuotaUsed: 0,
	syncQuotaLimit: 0,
};
const lastSyncAt = "2026-10-18T14:30:00Z";
const freshSyncAt = () => new Date(Date.now() - 60_000).toISOString();
const staleSyncAt = () =>
	new Date(Date.now() - SYNC_STALE_AFTER_MS - 60_000).toISOString();

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
	beforeEach(() => {
		acceptTestResource();
		resetServerQueryCache();
		resetNotifications();
		window.location.hash = "";
	});
	afterEach(() => {
		cleanup();
		resetNotifications();
		window.location.hash = "";
	});

	it("shows the server's last successful sync in browser-local time, including read-only mode", () => {
		const freshAt = freshSyncAt();
		setServerStatusFixture({
			...baseStatus,
			readOnly: true,
			syncConfigured: true,
			lastSyncAt: freshAt,
		});
		const view = renderSidebar();
		expect(
			view.getByText(`Last synced ${localSyncTime(freshAt)}`),
		).toBeTruthy();
		expect(view.container.querySelector("time")?.dateTime).toBe(freshAt);
		expect(view.queryByRole("button", { name: /sync/i })).toBeNull();
		expect(view.queryByText(/bridge\.example/)).toBeNull();
	});

	it.each([
		[null, "Sync status unavailable"],
		[{ ...baseStatus, syncConfigured: false }, "Sync not configured"],
		[{ ...baseStatus, syncConfigured: true }, "Never synced"],
		[
			{ ...baseStatus, syncConfigured: true, lastSyncAt: "not-a-time" },
			"Sync time unavailable",
		],
	] satisfies [ServerStatus | null, string][])(
		"renders honest sync state for %j",
		(status, label) => {
			if (status) setServerStatusFixture(status);
			const view = renderSidebar();
			expect(view.getByText(label)).toBeTruthy();
			expect(view.container.querySelector("time")).toBeNull();
		},
	);

	it("preserves a recorded sync time when sync is no longer configured", () => {
		setServerStatusFixture({
			...baseStatus,
			syncConfigured: false,
			lastSyncAt,
		});
		const view = renderSidebar();
		expect(
			view.getByText(`Last synced ${localSyncTime(lastSyncAt)}`),
		).toBeTruthy();
		expect(view.queryByRole("button", { name: /sync/i })).toBeNull();
	});

	it("flags a configured sync older than six hours with a warning", () => {
		const staleAt = staleSyncAt();
		setServerStatusFixture({
			...baseStatus,
			syncConfigured: true,
			lastSyncAt: staleAt,
			syncHost: "bridge.example",
		});
		const view = renderSidebar();
		const warning = view.getByRole("button", { name: /sync stale/i });
		expect(warning).toBeTruthy();
		expect(
			view.getByText(`Last synced ${localSyncTime(staleAt)}`, {
				exact: false,
			}),
		).toBeTruthy();
		expect(view.container.querySelector("time")?.dateTime).toBe(staleAt);
	});

	it("explains a stale sync and routes to bank sync on click", () => {
		const staleAt = staleSyncAt();
		setServerStatusFixture({
			...baseStatus,
			syncConfigured: true,
			lastSyncAt: staleAt,
			syncHost: "bridge.example",
		});
		const view = renderSidebar();
		fireEvent.click(view.getByRole("button", { name: /sync stale/i }));
		const toast = useNotifications
			.getState()
			.items.find((item) => item.key === "sync-stale");
		expect(toast?.kind).toBe("error");
		expect(toast?.message).toBe("Bank sync is stale.");
		expect(toast?.action?.label).toBe("Open bank sync");
		toast?.action?.onAction();
		expect(window.location.hash).toBe("#sources");
	});

	it("flips fresh to stale as the clock passes six hours", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-10-18T14:30:00Z"));
			const at = new Date(Date.now() - SYNC_STALE_AFTER_MS + 60_000);
			const status: ServerStatus = {
				...baseStatus,
				syncConfigured: true,
				lastSyncAt: at.toISOString(),
			};
			const view = render(<LastSync status={status} />);
			expect(view.queryByRole("button", { name: /sync stale/i })).toBeNull();
			vi.setSystemTime(new Date(Date.now() + 120_000));
			view.rerender(<LastSync status={status} />);
			expect(view.getByRole("button", { name: /sync stale/i })).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it("treats a six-hour-old sync as fresh and anything older as stale", () => {
		const now = new Date("2026-10-18T14:30:00Z").getTime();
		const at = (age: number) => new Date(now - age).toISOString();
		expect(isSyncStale(at(SYNC_STALE_AFTER_MS), now)).toBe(false);
		expect(isSyncStale(at(SYNC_STALE_AFTER_MS + 1), now)).toBe(true);
		expect(isSyncStale("not-a-time", now)).toBe(false);
	});

	it("updates the timestamp when server status changes", async () => {
		setServerStatusFixture({ ...baseStatus, syncConfigured: true });
		const view = renderSidebar();
		expect(view.getByText("Never synced")).toBeTruthy();
		const freshAt = freshSyncAt();
		await act(async () => {
			setServerStatusFixture({
				...baseStatus,
				syncConfigured: true,
				lastSyncAt: freshAt,
			});
		});
		expect(
			await view.findByText(`Last synced ${localSyncTime(freshAt)}`),
		).toBeTruthy();
		expect(view.queryByText("Never synced")).toBeNull();
	});

	it("defers sync copy until the sidebar finishes loading", () => {
		const view = renderSidebar(true);
		expect(view.queryByText(/synced|sync status/i)).toBeNull();
	});
});

describe("sidebar user placement", () => {
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

	it("keeps session user content out of the navigation sidebar", () => {
		const view = renderSession({
			enabled: true,
			authenticated: true,
			allowed: true,
			accountURL: "https://identity.example/account",
			resource: {
				id: `users/${"a".repeat(64)}`,
				permissions: ["user:read", "user:write"],
			},
			user: { subject: "editor", name: "Sam Lee" },
		});
		expect(view.queryByText("Sam Lee")).toBeNull();
		expect(view.queryByText("Account settings")).toBeNull();
		expect(view.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(view.queryByRole("button", { name: "Sign in" })).toBeNull();
		expect(
			view.getByRole("link", { name: "Configs" }).getAttribute("href"),
		).toBe("#sources");
	});
});
