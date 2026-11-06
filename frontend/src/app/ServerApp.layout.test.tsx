// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionContext } from "../auth/sessionContext.ts";
import { suspendUserScope } from "../auth/resourceScope.ts";
import { resetNotifications } from "../state/notifications.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import { stubTestServer } from "../mocks/waypointServer.ts";
import { resetUiStore } from "../state/uiStore.ts";
import type { ServerStatus } from "../api/contracts.ts";
import { userResourceKey } from "../state/workspaceResources.ts";
import { ServerApp } from "./ServerApp.tsx";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));
vi.mock("../workspace/WorkspaceContent.tsx", () => ({
	WorkspaceContent: () => <p>Workspace body</p>,
}));
vi.mock("./ServerWorkspaceRecovery.tsx", () => ({
	ServerWorkspaceRecovery: () => <p>Recovery body</p>,
}));

beforeEach(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	stubMatchMedia(false);
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

it("keeps the same sidebar node across workspace and recovery bodies", async () => {
	const server = stubTestServer();
	act(() => suspendUserScope());
	render(<ServerApp />);
	// The workspace body mounts without waiting for the scope; its own
	// slots wait on their queries. The sidebar is already present.
	expect(screen.getByText("Workspace body")).toBeTruthy();
	const sidebar = screen.getByRole("complementary", {
		name: "Workspace navigation",
	});
	expect(sidebar).toBeTruthy();

	act(() => {
		acceptTestResource();
	});
	expect(await screen.findByText("Workspace body")).toBeTruthy();
	expect(
		screen.getByRole("complementary", { name: "Workspace navigation" }),
	).toBe(sidebar);

	server.setStatus(status({ hasModel: false }));
	await refetchStatus();
	expect(await screen.findByText("Recovery body")).toBeTruthy();
	expect(
		screen.getByRole("complementary", { name: "Workspace navigation" }),
	).toBe(sidebar);
});

it("shows an unavailable error in the layout body without replacing the shell", async () => {
	stubTestServer();
	render(
		<SessionContext
			value={{
				session: null,
				phase: "unavailable",
				error:
					"The Waypoint server is unavailable (HTTP 503). It may be restarting; retry shortly.",
				refresh: vi.fn(async () => {}),
				logout: vi.fn(async () => {}),
				logoutPending: false,
			}}
		>
			<ServerApp />
		</SessionContext>,
	);
	expect(
		await screen.findByRole("heading", { name: "Cannot reach your data." }),
	).toBeTruthy();
	expect(
		screen.getByText(
			"The Waypoint server is unavailable (HTTP 503). It may be restarting; retry shortly.",
		),
	).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Retry access check" }),
	).toBeTruthy();
	// The layout stays: sidebar navigation is still present and interactive.
	expect(
		screen.getByRole("complementary", { name: "Workspace navigation" }),
	).toBeTruthy();
	expect(
		screen.getByRole("navigation", { name: "Main navigation" }),
	).toBeTruthy();
	expect(screen.queryByText("Workspace body")).toBeNull();
});

it("shows a denial in the layout body without replacing the shell", async () => {
	stubTestServer();
	render(
		<SessionContext
			value={{
				session: {
					enabled: true,
					authenticated: false,
					allowed: false,
					resource: {
						id: `users/${"a".repeat(64)}`,
						permissions: [],
					},
					user: { subject: "guest", name: "Guest" },
				},
				phase: "denied",
				error: "This user does not have access.",
				refresh: vi.fn(async () => {}),
				logout: vi.fn(async () => {}),
				logoutPending: false,
			}}
		>
			<ServerApp />
		</SessionContext>,
	);
	expect(
		await screen.findByRole("heading", {
			name: "Workspace access is unavailable",
		}),
	).toBeTruthy();
	expect(
		screen.getByRole("complementary", { name: "Workspace navigation" }),
	).toBeTruthy();
	expect(screen.queryByText("Workspace body")).toBeNull();
});
