// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUiStore, useUiStore } from "../state/uiStore.ts";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { resetNotifications } from "../state/notifications.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { testPlan } from "../test/plan.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerApp } from "./ServerApp.tsx";

vi.mock("../api/scopedClients.ts", () => ({
	defaultScopedApiClient: () => ({
		getStatus: async () => ({ readOnly: false }),
		getModel: async () => ({ document: null, issues: [] }),
		listAmountPresets: async () => ({ presets: [] }),
	}),
}));

// One call per root render, independent of child store subscriptions.
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
			<StoreReadout />
		</>
	),
}));

// The shell stand-in keeps independent child subscriptions beneath ServerApp.
function StoreReadout() {
	const presetError = useWorkspaceStore((state) => state.presetError);
	const name = useWorkspaceStore(
		(state) => state.workspace?.draft?.name ?? state.workspace?.saved.name,
	);
	return (
		<>
			<p>{presetError}</p>
			<p>{name}</p>
		</>
	);
}

function loadedWorkspace() {
	return {
		version: 1 as const,
		saved: testPlan,
		draft: null,
		baseFingerprint: null,
		baseRevision: null,
		draftStale: false,
	};
}

beforeEach(() => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	// ServerApp mounts the workspace without the session boundary, so verify
	// a fixture scope first like AuthBoundary would in production.
	acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: `plans/${"a".repeat(64)}`,
				kind: "private",
				permissions: ["plan:read"],
			},
			subject: "test-account",
		},
		suspendResourceScope(),
	);
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetUiStore();
	resetNotifications();
	vi.unstubAllGlobals();
});

describe("ServerApp subscriptions", () => {
	it("keeps the root stable while notice, preset, volatile, and plan children update", async () => {
		render(<ServerApp />);
		await waitFor(() =>
			expect(screen.queryByText("Recovery screen")).not.toBeNull(),
		);
		act(() => useWorkspaceStore.setState({ workspace: loadedWorkspace() }));
		const rootRenders = vi.mocked(useWorkspaceNavigation).mock.calls.length;

		act(() =>
			useWorkspaceStore.setState({ notice: "Plan saved on the server." }),
		);
		expect(screen.getByRole("status").textContent).toContain(
			"Plan saved on the server.",
		);
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);
		fireEvent.click(
			screen.getByRole("button", { name: "Dismiss notification" }),
		);
		expect(screen.queryByRole("status")).toBeNull();
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);

		act(() =>
			useWorkspaceStore.setState({ presetError: "Recipe service unavailable" }),
		);
		// The test readout renders the raw value while the notification
		// subscription floats the same failure as a toast.
		expect(screen.getAllByText("Recipe service unavailable")).toHaveLength(2);
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);

		act(() => useWorkspaceStore.setState({ volatile: true }));
		expect(screen.queryByRole("button", { name: /local draft/ })).toBeNull();
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);

		act(() =>
			useWorkspaceStore.setState({
				workspace: {
					...loadedWorkspace(),
					draft: { ...testPlan, name: "Edited browser draft" },
				},
			}),
		);
		expect(screen.getByText("Edited browser draft")).toBeTruthy();
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);

		act(() =>
			useWorkspaceStore.setState({
				error: "Storage changed in another tab",
				errorCode: null,
			}),
		);
		expect(screen.getByText("Storage changed in another tab")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Reload latest saved plan" }),
		).toBeTruthy();
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);
	});

	it("switches screens on availability, load, and import gates", async () => {
		render(<ServerApp />);
		expect(screen.getByText("Loading screen")).toBeTruthy();
		await waitFor(() =>
			expect(screen.queryByText("Recovery screen")).not.toBeNull(),
		);
		act(() => useUiStore.getState().setImporting(true));
		expect(screen.getByText("Loading screen")).toBeTruthy();
		act(() => useUiStore.getState().setImporting(false));
		expect(screen.getByText("Recovery screen")).toBeTruthy();
		act(() => useWorkspaceStore.setState({ loading: true }));
		expect(screen.getByText("Loading screen")).toBeTruthy();
		act(() => useWorkspaceStore.setState({ workspace: loadedWorkspace() }));
		expect(screen.getByText("Workspace screen")).toBeTruthy();
		act(() => useWorkspaceStore.setState({ loading: false, workspace: null }));
		expect(screen.getByText("Recovery screen")).toBeTruthy();
	});
});
