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
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { testPlan } from "../test/plan.ts";
import {
	WorkspaceNotices,
	WorkspaceNotification,
} from "../workspace/WorkspaceNotices.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerApp } from "./ServerApp.tsx";

vi.mock("../api/index.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/index.ts")>()),
	createApiClient: () => ({
		getStatus: async () => ({ readOnly: false, authEnabled: false }),
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
			<WorkspaceNotices />
			<WorkspaceNotification />
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
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetUiStore();
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
		expect(screen.getByText("Recipe service unavailable")).toBeTruthy();
		expect(useWorkspaceNavigation).toHaveBeenCalledTimes(rootRenders);

		act(() => useWorkspaceStore.setState({ volatile: true }));
		expect(
			screen.getByRole("button", { name: /Export local draft recovery/ }),
		).toBeTruthy();
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
			useWorkspaceStore.setState({ error: "Storage changed in another tab" }),
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
