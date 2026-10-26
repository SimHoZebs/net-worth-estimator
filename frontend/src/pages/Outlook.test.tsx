import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetWorkspaceStore } from "../state/workspaceStore.ts";
import { testPlan } from "../test/plan.ts";
import { acceptTestResource } from "../test/resource.ts";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../test/workspace.ts";
import { Outlook } from "./Outlook.tsx";

vi.mock("../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => ({
		base: null,
		loading: false,
		status: "disabled",
	}),
}));

vi.mock("../state/useCurrentPosition.ts", () => ({
	useCurrentPosition: () => ({
		data: null,
		status: "disabled",
		error: null,
		retry: vi.fn(),
	}),
}));

const blankPlan = { ...testPlan, accounts: [], movements: [], evaluations: [] };
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
	acceptTestResource();
	setServerModelFixture(blankPlan);
	setServerStatusFixture({ readOnly: false });
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
		setServerModelFixture({
			...blankPlan,
			readOnly: restriction === "plan" || restriction === "writeBlocked",
		});
		setServerStatusFixture({ readOnly: restriction === "server" });
		render(<Outlook {...props} />);
		expect(
			screen.queryByRole("button", { name: "Add your first account" }),
		).toBeNull();
	},
);
