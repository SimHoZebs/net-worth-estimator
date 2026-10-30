import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
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

const blankData = {
	...financialModelFixture,
	accounts: [],
	transactions: [],
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
	setServerModelFixture(blankData);
	setServerStatusFixture({ readOnly: false });
});

afterEach(() => {
	cleanup();
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

it("honors the server write restriction on a blank workspace", () => {
	setServerStatusFixture({ readOnly: true });
	render(<Outlook {...props} />);
	expect(
		screen.queryByRole("button", { name: "Add your first account" }),
	).toBeNull();
});

it("does not gate the blank workspace on a model-level flag alone", () => {
	setServerModelFixture({ ...blankData, readOnly: true });
	render(<Outlook {...props} />);
	expect(
		screen.getByRole("button", { name: "Add your first account" }),
	).toBeTruthy();
});
