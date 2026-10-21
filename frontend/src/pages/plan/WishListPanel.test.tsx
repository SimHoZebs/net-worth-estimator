import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movement, Plan } from "../../domain/model.ts";
import { testPlan } from "../../test/plan.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { WishListPanel } from "./WishListPanel.tsx";

afterEach(() => {
	cleanup();
	useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

const laptop: Movement = {
	...testPlan.movements[0]!,
	id: "laptop",
	name: "Laptop",
	frequency: "once",
	amount: 500,
	fromId: "checking",
	toId: null,
	annualIncrease: 0,
	purchasePriority: 0,
};
const chair: Movement = {
	...laptop,
	id: "chair",
	name: "Chair",
	amount: 150,
	purchasePriority: 1,
};
const plan = { ...testPlan, movements: [laptop, chair] };

describe("wish list", () => {
	it("offers keyboard-operable priority controls and announces a move", () => {
		const update = vi.fn<(plan: Plan) => boolean>(() => true);
		useWorkspaceStore.setState({ updatePlan: update });
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		fireEvent.click(view.getByRole("button", { name: "Move Chair up" }));
		expect(
			update.mock.calls[0]![0].movements.find(
				(item: Movement) => item.id === "chair",
			)?.purchasePriority,
		).toBe(0);
		expect(view.getByRole("status").textContent).toContain(
			"Chair is now priority 1",
		);
	});

	it("shows backend dates, unfunded items, and no stale dates without a current forecast", () => {
		const schedule = {
			purchases: [
				{ postingId: "laptop", date: "2027-02-05", amount: 500 },
				{ postingId: "chair", date: null, amount: 150 },
			],
		};
		const view = render(<WishListPanel plan={plan} schedule={schedule} />);
		expect(view.getByText("Feb 5, 2027")).toBeTruthy();
		expect(view.getByText("Not funded within this timeframe")).toBeTruthy();
		view.rerender(<WishListPanel plan={plan} schedule={null} />);
		expect(view.queryByText("Feb 5, 2027")).toBeNull();
		expect(view.getAllByText("Awaiting current forecast")).toHaveLength(2);
	});

	it("blocks edits on a read-only server", () => {
		useWorkspaceStore.setState({
			status: { readOnly: true, authEnabled: false },
		});
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		for (const button of view.getAllByRole("button"))
			expect((button as HTMLButtonElement).disabled).toBe(true);
	});
});
