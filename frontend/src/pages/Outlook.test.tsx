import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	resetWorkspaceStore,
	type RemoteWorkspace,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { testPlan } from "../test/plan.ts";
import { Outlook } from "./Outlook.tsx";

vi.mock("../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => ({ base: null, loading: false }),
}));

const blankPlan = { ...testPlan, accounts: [], movements: [], evaluations: [] };
const workspace: RemoteWorkspace = {
	version: 1,
	saved: blankPlan,
	draft: null,
	baseFingerprint: null,
	baseRevision: null,
	draftStale: false,
};
const props = {
	onAddAccount: vi.fn(),
	onEvidence: vi.fn(),
	onFailure: vi.fn(),
	onTransactions: vi.fn(),
	safeSpendingDetail: null,
	onSafeSpendingDetail: vi.fn(),
	onSafeSpendingTab: vi.fn(),
};

beforeEach(() => {
	useWorkspaceStore.setState({
		workspace,
		status: { readOnly: false },
	});
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	vi.clearAllMocks();
});

it("opens the first-account editor from an active blank workspace", () => {
	render(<Outlook {...props} />);
	expect(
		screen.getByRole("heading", { name: "Your workspace is ready" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Add your first account" }),
	);
	expect(props.onAddAccount).toHaveBeenCalledOnce();
});

it.each(["plan", "server", "writeBlocked"])(
	"honors %s write restrictions on a blank workspace",
	(restriction) => {
		useWorkspaceStore.setState({
			workspace: {
				...workspace,
				saved: { ...blankPlan, readOnly: restriction === "plan" },
				draft: null,
			},
			status: { readOnly: restriction === "server" },
			writeBlocked: restriction === "writeBlocked",
		});
		render(<Outlook {...props} />);
		expect(
			screen.queryByRole("button", { name: "Add your first account" }),
		).toBeNull();
	},
);
