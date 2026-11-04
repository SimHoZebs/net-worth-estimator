import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { financialModelFixture } from "../../../mocks/financialModel.ts";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import type { SafeSpendingChargeCycle } from "./safeSpendingDetailModel.ts";

afterEach(cleanup);

function charge(
	date: string,
	amount: number,
	name: string,
): AccountTransaction {
	return {
		id: `charge-${date}`,
		transactionId: `charge-${date}`,
		date,
		name,
		source: "historical",
		direction: "out",
		category: "expense",
		counterparty: "External spending",
		from: "Household card",
		to: "External spending",
		amount,
		requested: amount,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
	};
}

function follows(anchor: HTMLElement, target: HTMLElement) {
	return Boolean(
		anchor.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
	);
}

const current: SafeSpendingChargeCycle = {
	start: "2026-09-20",
	end: "2026-10-19",
	title: "Recorded card charges",
	emptyMessage: "No charges in this cycle yet.",
	transactions: [],
};

function show(
	cycle: SafeSpendingChargeCycle,
	order: "newest" | "oldest" = "newest",
) {
	const sorted = [...cycle.transactions].sort((left, right) =>
		order === "oldest"
			? left.date.localeCompare(right.date)
			: right.date.localeCompare(left.date),
	);
	return render(
		<SafeSpendingCyclePanel
			cycle={{ ...cycle, transactions: sorted }}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			readOnly={financialModelFixture.readOnly}
			transactionOrder={order}
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
		});
		expect(screen.getByText("No recorded charges in last cycle.")).toBeTruthy();
		expect(
			screen.queryByRole("list", { name: "Closed card balances" }),
		).toBeNull();
	});

	const spending: SafeSpendingChargeCycle = {
		...current,
		transactions: [
			charge("2026-09-20", 50, "Charge Sep 20"),
			charge("2026-09-22", 300, "Charge Sep 22"),
			charge("2026-09-25", 400, "Charge Sep 25"),
		],
		thresholds: {
			safetyNetDate: "2026-09-22",
			limitDate: "2026-09-25",
		},
	};

	it("places threshold dividers after the crossing date in newest-first order", () => {
		show(spending, "newest");
		const reserve = screen.getByRole("separator", {
			name: "Protected reserve starts",
		});
		const limit = screen.getByRole("separator", {
			name: "Card spending limit",
		});
		const sep20 = screen.getByText("Charge Sep 20");
		const sep22 = screen.getByText("Charge Sep 22");
		const sep25 = screen.getByText("Charge Sep 25");
		expect(follows(limit, sep25)).toBe(true);
		expect(follows(sep25, reserve)).toBe(true);
		expect(follows(reserve, sep22)).toBe(true);
		expect(follows(sep22, sep20)).toBe(true);
	});

	it("places threshold dividers after the crossing date in oldest-first order", () => {
		show(spending, "oldest");
		const reserve = screen.getByRole("separator", {
			name: "Protected reserve starts",
		});
		const limit = screen.getByRole("separator", {
			name: "Card spending limit",
		});
		const sep20 = screen.getByText("Charge Sep 20");
		const sep22 = screen.getByText("Charge Sep 22");
		const sep25 = screen.getByText("Charge Sep 25");
		expect(follows(sep20, sep22)).toBe(true);
		expect(follows(sep22, reserve)).toBe(true);
		expect(follows(reserve, sep25)).toBe(true);
		expect(follows(sep25, limit)).toBe(true);
	});

	it("shows only the stricter divider when both thresholds cross on one date", () => {
		show({
			...spending,
			thresholds: {
				safetyNetDate: "2026-09-25",
				limitDate: "2026-09-25",
			},
		});
		const dividers = screen.getAllByRole("separator");
		expect(dividers).toHaveLength(1);
		expect(dividers[0]?.getAttribute("aria-label")).toBe("Card spending limit");
	});
});
