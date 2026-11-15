import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccountTransaction } from "@/domain/accountActivity.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import { selectObligationResults } from "@/domain/safeSpendingHistory.ts";
import { historicalCycleView } from "./historicalCycleView.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { cycleCaption } from "./safeSpendingDetailModel.ts";

export const recordedCharge: AccountTransaction = {
	id: "purchase",
	transactionId: "purchase",
	date: "2026-10-05",
	name: "Synthetic purchase",
	source: "historical",
	direction: "out",
	flow: "expense",
	counterparty: "Merchant",
	from: "Test card",
	to: "Merchant",
	amount: 125,
	requested: 125,
	shortfall: 0,
	constraint: null,
	excluded: false,
	pending: false,
	void: false,
};

export function historicalFixture(transactionIds: string[] | null = null) {
	return historicalCycleView({
		closedCycle: {
			start: "2026-09-20",
			end: "2026-10-19",
			total: null,
			cards: [],
		},
		cardTransactions: [recordedCharge],
		billResults: selectObligationResults(
			[
				transactionFixture({
					transactionId: "one-time-card-settlement",
					name: "Recorded card payment",
					date: "2026-10-01",
					fromId: "checking",
					toId: "test_card",
					requested: 80,
					realized: 80,
					posted: true,
				}),
				transactionFixture({
					date: "2026-10-02",
					fromId: "checking",
					requested: 900,
					realized: 900,
					posted: false,
				}),
			],
			transactionIds,
		),
		spendingIds: ["checking"],
		accounts: [],
		savedTransactions: [],
		transactionOrder: "newest",
	});
}

describe("historical cycle evidence", () => {
	it("captions the selected closed cycle rather than the current closing countdown", () => {
		expect(
			cycleCaption({
				start: "2026-09-20",
				end: "2026-10-19",
				closed: true,
				daysLeft: 4,
			}),
		).toBe("Sep 20, 2026 – Oct 19, 2026 · Closed");
		expect(
			cycleCaption({
				start: "2026-10-20",
				end: "2026-11-19",
				closed: false,
				daysLeft: 4,
			}),
		).toBe("Nov 19, 2026 · 4 days left");
	});
	it("keeps recorded charge activity available without inventing closed debt or a budget", () => {
		const { view, trend } = historicalFixture();
		expect(view.heroes.committedTotal).toBe(125);
		expect(view.heroes.closedCycle.total).toBeNull();
		expect(view.allocation.available).toBe(false);
		expect(trend.actual.at(-1)?.spent).toBe(125);
		expect(trend.limit).toBeNull();
		expect(trend.safetyNet).toBeNull();
		expect(trend.limitHit).toBeNull();
		expect(trend.safetyNetHit).toBeNull();
		expect(trend.projected).toEqual([]);
	});
	it("shows recorded bill payments rather than inferred schedule history", () => {
		const { section } = historicalFixture();
		expect(section.transactions).toHaveLength(1);
		expect(section.total).toBe(80);
		expect(section.transactions[0]?.transactionId).toBe(
			"one-time-card-settlement",
		);
	});
	it("honors an explicit bill selection without inventing a claim for a one-time settlement", () => {
		const { section } = historicalFixture(["selected-schedule"]);
		expect(section.transactions).toEqual([]);
		expect(section.total).toBe(0);
	});
	it("renders unavailable close cash without latest cash bars or budget claims", () => {
		const { view, section } = historicalFixture();
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Cash balance at close unavailable",
				section: { ...section, transactions: [] },
				accounts: [],
				transactions: [],
				readOnly: true,
				transactionOrder: "newest",
				onTransactionOrderChange: () => {},
				closed: true,
			}),
		);
		expect(html).toContain("Cash balance at close unavailable");
		expect(html).toContain("Historical budget unavailable");
		expect(html).toContain("Recorded card charges");
		expect(html).toContain("No recorded bill payments in this period.");
		expect(html).not.toContain("No bills due in this period.");
		expect(html).toContain("125");
		expect(html).not.toContain("left-value");
		expect(html).not.toContain("spend-value");
		expect(html).not.toContain("perday-value");
		expect(html).not.toContain("Latest balance");
		expect(html).not.toContain("lucide-shield-check");
		expect(html).not.toContain("Cash balance 0");
	});
});
