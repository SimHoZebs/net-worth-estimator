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
import type { FinancialModelResponse } from "../api/index.ts";
import { suspendUserScope } from "../auth/resourceScope.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import {
	acceptOwnerResource,
	acceptTestResource,
	GUEST_USER_ID,
	GUEST_USER_SUBJECT,
} from "../mocks/resource.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { AuthBoundary } from "../auth/AuthBoundary.tsx";
import { ok } from "../mocks/fetch.ts";
import { ServerApp } from "./ServerApp.tsx";
import { stubTestServer } from "../mocks/waypointServer.ts";

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

function stubWorkspaceFetch() {
	const server = stubTestServer();
	server.failModelOnce({
		model: null,
		issues: [],
		revision: "r1",
	} as unknown as FinancialModelResponse);
}
vi.mock("../workspace/useWorkspaceNavigation.ts", () => ({
	useWorkspaceNavigation: vi.fn(() => ({})),
}));
vi.mock("./ServerLoadingShell.tsx", () => ({
	ServerLoadingShell: () => <p>Loading screen</p>,
}));
vi.mock("./ServerWorkspaceRecovery.tsx", () => ({
	ServerWorkspaceRecovery: () => <p>Recovery screen</p>,
}));
vi.mock("../WorkspaceShell.tsx", () => ({
	WorkspaceShell: () => (
		<>
			<p>Workspace screen</p>
			<NotificationCenter />
		</>
	),
}));

beforeEach(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	acceptTestResource();
	stubWorkspaceFetch();
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

it("keeps notification state out of the root's server loading gate", async () => {
	render(<ServerApp />);
	await screen.findByText("Recovery screen");
	act(() => {
		setServerModelFixture();
	});
	await screen.findByText("Workspace screen");
	const rootRenders = vi.mocked(useWorkspaceNavigation).mock.calls.length;
	act(() => notifySuccess("workspace-notice", "Changes saved on the server."));
	expect(screen.getByRole("status").textContent).toContain(
		"Changes saved on the server.",
	);
	fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
	expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);
});

it("uses Query availability and import state to select the screen", async () => {
	render(<ServerApp />);
	expect(screen.getByText("Loading screen")).toBeTruthy();
	await screen.findByText("Recovery screen");
	act(() => useUiStore.getState().setImporting(true));
	expect(screen.getByText("Loading screen")).toBeTruthy();
	act(() => useUiStore.getState().setImporting(false));
	expect(screen.getByText("Recovery screen")).toBeTruthy();
	act(() => {
		setServerModelFixture();
	});
	await waitFor(() =>
		expect(screen.getByText("Workspace screen")).toBeTruthy(),
	);
});

it("waits for a ready scope before starting resource queries", async () => {
	const server = stubTestServer();
	act(() => suspendUserScope());
	render(<ServerApp />);
	expect(screen.getByText("Loading screen")).toBeTruthy();
	expect(server.modelFetches()).toHaveLength(0);
	act(() => {
		acceptTestResource();
	});
	await screen.findByText("Workspace screen");
	expect(server.modelFetches()).toHaveLength(1);
});

it("uses the next owner's scope for its first workspace fetch", async () => {
	const next = `users/${"b".repeat(64)}`;
	const server = stubTestServer();
	render(<ServerApp />);
	await screen.findByText("Workspace screen");
	act(() => {
		acceptOwnerResource(next);
	});
	await waitFor(() => expect(server.modelFetches()).toHaveLength(2));
	const modelCall = server.fetcher.mock.calls
		.filter(([url]) => String(url).endsWith("/v1/financial-model"))
		.at(-1);
	expect(
		new Headers((modelCall?.[1] as RequestInit | undefined)?.headers).get(
			"Waypoint-Resource",
		),
	).toBe(next);
});

it("loads an allowed guest workspace without a sign-in redirect", async () => {
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
	const [modelCall] = server.fetcher.mock.calls.filter(([url]) =>
		String(url).endsWith("/v1/financial-model"),
	);
	expect(
		new Headers((modelCall?.[1] as RequestInit | undefined)?.headers).get(
			"Waypoint-Resource",
		),
	).toBe(GUEST_USER_ID);
});
