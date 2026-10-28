import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../../mocks/resource.ts";
import { setServerStatusFixture } from "../../mocks/workspace.ts";
import type { PlannedPurchase, Plan } from "../../domain/model.ts";
import { testPlan } from "../../mocks/plan.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { WishListPanel } from "./WishListPanel.tsx";

beforeEach(() => {
	acceptTestResource();
	setServerStatusFixture({ readOnly: false });
});

afterEach(() => {
	cleanup();
	useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

const laptop: PlannedPurchase = {
	id: "laptop",
	name: "Laptop",
	amount: 500,
	fromId: "checking",
	startDate: testPlan.startDate,
	enabled: true,
	readOnly: false,
};
const chair: PlannedPurchase = {
	...laptop,
	id: "chair",
	name: "Chair",
	amount: 150,
};
const plan = { ...testPlan, plannedPurchases: [laptop, chair] };

describe("wish list", () => {
	it("names the purchase region and its independent priority and date lists", () => {
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		const region = view.getByRole("region", { name: "Planned purchases" });
		expect(region.tagName).toBe("SECTION");
		for (const name of ["Purchase priorities", "Purchase dates"]) {
			const list = within(region).getByRole("list", { name });
			expect(list.tagName).toBe("OL");
			expect(within(list).getAllByRole("listitem")).toHaveLength(2);
		}
	});

	it("preserves native labels, icons, and disabled queue boundaries", () => {
		const update = vi.fn<(plan: Plan) => boolean>(() => true);
		useWorkspaceStore.setState({ updatePlan: update });
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		for (const [label, disabled, iconSize] of [
			["Move Laptop up", true, "16"],
			["Move Laptop down", false, "16"],
			["Edit Laptop", false, "15"],
			["Remove Laptop", false, "15"],
			["Move Chair up", false, "16"],
			["Move Chair down", true, "16"],
		] as const) {
			const button = view.getByRole("button", {
				name: label,
			}) as HTMLButtonElement;
			expect(button.type).toBe("button");
			expect(button.disabled).toBe(disabled);
			expect(button.title).toBe(label);
			expect(button.querySelector("svg")?.getAttribute("width")).toBe(iconSize);
			expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
				"true",
			);
		}
		fireEvent.click(view.getByRole("button", { name: "Move Laptop up" }));
		expect(update).not.toHaveBeenCalled();
	});

	it("offers keyboard-operable priority controls and announces a move", () => {
		const update = vi.fn<(plan: Plan) => boolean>(() => true);
		useWorkspaceStore.setState({ updatePlan: update });
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		fireEvent.click(view.getByRole("button", { name: "Move Chair up" }));
		expect(
			update.mock.calls[0]![0].plannedPurchases.find(
				(item: PlannedPurchase) => item.id === "chair",
			),
		).toEqual({ ...chair });
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
		setServerStatusFixture({ readOnly: true });
		const view = render(<WishListPanel plan={plan} schedule={null} />);
		for (const button of view.getAllByRole("button"))
			expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it("locks source-owned purchases without locking other items", () => {
		const view = render(
			<WishListPanel
				plan={{
				...plan,
				plannedPurchases: [{ ...laptop, readOnly: true }, chair],
			}}
				schedule={null}
			/>,
		);
		for (const name of [
			"Move Laptop up",
			"Move Laptop down",
			"Edit Laptop",
			"Remove Laptop",
		])
			expect(
				(view.getByRole("button", { name }) as HTMLButtonElement).disabled,
			).toBe(true);
		expect(
			(view.getByRole("button", { name: "Edit Chair" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});
});
