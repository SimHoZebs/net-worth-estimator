import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetWorkspaceStore } from "../state/workspaceStore.ts";
import { testAccount } from "../mocks/account.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../mocks/workspace.ts";
import { Outlook } from "./Outlook.tsx";

vi.mock("../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => ({
		base: null,
		loading: false,
		status: "disabled",
	}),
}));

const blankPlan = {
	...testAccount,
	accounts: [],
	movements: [],
	evaluations: [],
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
