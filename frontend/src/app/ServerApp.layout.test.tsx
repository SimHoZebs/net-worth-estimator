// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
