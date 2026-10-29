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
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import type { FinancialModelResponse } from "../api/index.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { testAccount } from "../mocks/account.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useAccountPlan } from "../state/useAccountScope.ts";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerApp } from "./ServerApp.tsx";
import { stubTestServer } from "../mocks/waypointServer.ts";

function stubWorkspaceFetch() {
	const server = stubTestServer();
	server.failModelOnce({
		document: null,
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
			<Readout />
		</>
	),
}));
function Readout() {
	return <p>{useAccountPlan()?.name}</p>;
}

beforeEach(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	acceptTestResource();
	stubWorkspaceFetch();
	resetServerQueryCache();
	resetWorkspaceStore();
	vi.clearAllMocks();
});
afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetServerQueryCache();
	resetUiStore();
	resetNotifications();
	vi.unstubAllGlobals();
});

it("keeps notification and draft-storage state out of the root's server loading gate", async () => {
	render(<ServerApp />);
	await screen.findByText("Recovery screen");
	act(() => {
		setServerModelFixture();
	});
	await screen.findByText("Workspace screen");
	const rootRenders = vi.mocked(useWorkspaceNavigation).mock.calls.length;
	act(() => notifySuccess("workspace-notice", "Plan saved on the server."));
	expect(screen.getByRole("status").textContent).toContain(
		"Plan saved on the server.",
	);
	fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
	act(() => useWorkspaceStore.setState({ error: "transient" }));
	expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);
	act(() => useWorkspaceStore.setState({ error: null }));
	act(() =>
		useWorkspaceStore.setState({
			draft: { ...testAccount, name: "Edited browser draft" },
		}),
	);
	expect(screen.getByText("Edited browser draft")).toBeTruthy();
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
