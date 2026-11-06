import type { ReactNode } from "react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetUiStore, useUiStore } from "../state/uiStore.ts";
import { notifySuccess, resetNotifications } from "../state/notifications.ts";
import { suspendUserScope } from "../auth/resourceScope.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import {
	acceptOwnerResource,
	acceptTestResource,
	GUEST_USER_ID,
	GUEST_USER_SUBJECT,
} from "../mocks/resource.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { AuthBoundary } from "../auth/AuthBoundary.tsx";
import { ok } from "../mocks/fetch.ts";
import { ServerApp } from "./ServerApp.tsx";
import { stubTestServer } from "../mocks/waypointServer.ts";
import type { ServerStatus } from "../api/contracts.ts";
import { userResourceKey } from "../state/workspaceResources.ts";

function sessionResponse(id: string, authenticated: boolean) {
	const headers = new Headers({ "content-type": "application/json" });
	headers.set("Waypoint-Resource", id);
	return new Response(
		JSON.stringify({
			enabled: true,
			authenticated,
			allowed: true,
			resource: {
				id,
				permissions: authenticated
					? ["user:read", "user:project", "user:write"]
					: ["user:read", "user:project"],
			},
			user: {
				subject: authenticated ? id : GUEST_USER_SUBJECT,
				name: authenticated ? "Account" : "Guest",
			},
		}),
		{ headers },
	);
}

function status(overrides: Partial<ServerStatus> = {}): ServerStatus {
	return {
		readOnly: false,
		hasModel: true,
		syncConfigured: true,
		syncQuotaUsed: 0,
		syncQuotaLimit: 24,
		...overrides,
	};
}

async function refetchStatus() {
	await act(async () => {
		await serverQueryClient().refetchQueries({
			queryKey: userResourceKey("status"),
		});
	});
}

vi.mock("../workspace/useWorkspaceNavigation.ts", () => ({
	useWorkspaceNavigation: vi.fn(() => ({})),
}));
// The layout stays mounted across every body state, so state selection is tested
// through the mocked body and the real layout identity.
vi.mock("../workspace/WorkspaceLayout.tsx", () => ({
	WorkspaceLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../workspace/WorkspaceHeader.tsx", () => ({
	WorkspaceHeading: () => null,
	WorkspaceTopbar: () => null,
}));
vi.mock("./ServerWorkspaceRecovery.tsx", () => ({
	ServerWorkspaceRecovery: () => <p>Recovery screen</p>,
}));
vi.mock("../workspace/WorkspaceContent.tsx", () => ({
	WorkspaceContent: () => (
		<>
			<p>Workspace screen</p>
			<NotificationCenter />
		</>
	),
}));

beforeEach(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	acceptTestResource();
	resetServerQueryCache();
	vi.clearAllMocks();
});
afterEach(() => {
	cleanup();
	resetServerQueryCache();
	resetUiStore();
	resetNotifications();
	vi.unstubAllGlobals();
});

it("keeps notification state out of the root's data gate", async () => {
	stubTestServer();
	render(<ServerApp />);
	await screen.findByText("Workspace screen");
	const rootRenders = vi.mocked(useWorkspaceNavigation).mock.calls.length;
	act(() => notifySuccess("workspace-notice", "Changes saved on the server."));
	expect(screen.getByRole("status").textContent).toContain(
		"Changes saved on the server.",
	);
	fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
	expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);
});

it("uses workspace presence to select the screen", async () => {
	const server = stubTestServer();
	server.setStatus(status({ hasModel: false }));
	render(<ServerApp />);
	await screen.findByText("Recovery screen");
	// Importing does not replace the body with a whole-app skeleton; only
	// the slots waiting on a query show their own skeleton.
	act(() => useUiStore.getState().setImporting(true));
	expect(screen.getByText("Recovery screen")).toBeTruthy();
	act(() => useUiStore.getState().setImporting(false));
	expect(screen.getByText("Recovery screen")).toBeTruthy();
	server.setStatus(status());
	await refetchStatus();
	await waitFor(() =>
		expect(screen.getByText("Workspace screen")).toBeTruthy(),
	);
});

it("mounts the workspace body before the scope is ready without starting queries", async () => {
	const server = stubTestServer();
	act(() => suspendUserScope());
	render(<ServerApp />);
	// The body mounts at once; its own slots wait on their queries. Only the
	// resource fetch is gated on a ready scope.
	expect(screen.getByText("Workspace screen")).toBeTruthy();
	expect(
		server.calls.filter((call) => call.url.endsWith("/v1/status")),
	).toHaveLength(0);
	expect(server.modelFetches()).toHaveLength(0);
	act(() => {
		acceptTestResource();
	});
	await screen.findByText("Workspace screen");
	expect(
		server.calls.filter((call) => call.url.endsWith("/v1/status")),
	).toHaveLength(1);
	// Presence is a status flag. The workspace body never reads the model document.
	expect(server.modelFetches()).toHaveLength(0);
});

it("leaves amount presets to the amounts view", async () => {
	const server = stubTestServer();
	render(<ServerApp />);
	await screen.findByText("Workspace screen");
	expect(
		server.calls.filter((call) => call.url.endsWith("/v1/amount-presets")),
	).toHaveLength(0);
});

it("uses the next owner's scope for its first workspace fetch", async () => {
	const next = `users/${"b".repeat(64)}`;
	const server = stubTestServer();
	render(<ServerApp />);
	await screen.findByText("Workspace screen");
	act(() => {
		acceptOwnerResource(next);
	});
	await waitFor(() =>
		expect(
			server.calls.filter((call) => call.url.endsWith("/v1/status")),
		).toHaveLength(2),
	);
	const statusCall = server.fetcher.mock.calls
		.filter(([url]) => String(url).endsWith("/v1/status"))
		.at(-1);
	expect(
		new Headers((statusCall?.[1] as RequestInit | undefined)?.headers).get(
			"Waypoint-Resource",
		),
	).toBe(next);
});

it("loads an allowed guest workspace without a sign-in redirect", async () => {
	act(() => suspendUserScope());
	const server = stubTestServer();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const path = String(url);
			if (path.endsWith("/v1/auth/session"))
				return sessionResponse(GUEST_USER_ID, false);
			if (path.endsWith("/v1/safe-spending-settings"))
				return ok({ settings: null });
			return server.fetcher(url, init);
		}),
	);
	render(
		<AuthBoundary>
			<ServerApp />
		</AuthBoundary>,
	);
	expect(await screen.findByText("Workspace screen")).toBeTruthy();
	const [statusCall] = server.fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/v1/status"),
	);
	expect(
		new Headers((statusCall?.[1] as RequestInit | undefined)?.headers).get(
			"Waypoint-Resource",
		),
	).toBe(GUEST_USER_ID);
});
