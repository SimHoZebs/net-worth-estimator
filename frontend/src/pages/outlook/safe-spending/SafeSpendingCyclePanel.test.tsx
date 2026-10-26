import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { testPlan } from "../../../mocks/plan.ts";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import type { SafeSpendingChargeCycle } from "./safeSpendingDetailModel.ts";

afterEach(cleanup);

const current: SafeSpendingChargeCycle = {
	start: "2026-09-20",
	end: "2026-10-19",
	title: "Recorded card charges",
	emptyMessage: "No charges in this cycle yet.",
	transactions: [],
};

function show(cycle: SafeSpendingChargeCycle) {
	return render(
		<SafeSpendingCyclePanel
			cycle={cycle}
			plan={testPlan}
			transactionOrder="newest"
			onTransactionOrderChange={() => {}}
		/>,
	);
}

describe("SafeSpendingCyclePanel", () => {
	it("renders only this cycle's dates and empty state", () => {
		show(current);
		expect(screen.getByText("Recorded card charges")).toBeTruthy();
		expect(screen.getByText("No charges in this cycle yet.")).toBeTruthy();
		expect(
			screen.queryByRole("list", { name: "Closed card balances" }),
		).toBeNull();
	});

	it("shows last cycle's recorded history without duplicating the budget", () => {
		show({
			...current,
			title: "Recorded card charges",
			emptyMessage: "No recorded charges in last cycle.",
			note: "Recorded charges can be incomplete.",
		});
		expect(
			screen.getByText("Recorded charges can be incomplete."),
		).toBeTruthy();
		expect(screen.getByText("No recorded charges in last cycle.")).toBeTruthy();
		expect(
			screen.queryByRole("list", { name: "Closed card balances" }),
		).toBeNull();
	});
});
