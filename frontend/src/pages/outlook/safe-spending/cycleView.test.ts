import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccountTransaction } from "@/domain/accountActivity.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import { selectObligationResults } from "@/domain/safeSpendingHistory.ts";
import { historicalCycleView } from "./historicalCycleView.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { cycleCaption } from "./safeSpendingDetailModel.ts";

// Card/drawer placement belongs to these panels; row query hooks are covered by
// the browser test with real transaction inspection.
vi.mock("../../../components/activity/TransactionRow.tsx", () => ({
	TransactionRow: ({ transaction }: { transaction: AccountTransaction }) =>
		createElement("tr", null, createElement("td", null, transaction.name)),
}));

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
	it("keeps current spending decision rows without card allowance or paycheck captions", () => {
		const { view, section } = historicalFixture();
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Known cash evidence",
				section,
				closed: false,
			}),
		);
		expect(html).toContain("Known cash evidence");
		expect(html).toContain('data-testid="spend-value"');
		expect(html).toContain('data-testid="perday-value"');
		expect(html).not.toContain("Card allowance");
		expect(html).not.toContain("paycheck");
		expect(html).not.toContain("this statement");
	});
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
				closed: true,
			}),
		);
		expect(html).toContain("Cash balance at close unavailable");
		expect(html).not.toContain("Historical budget unavailable");
		expect(html).not.toContain("closed-card-value");
		expect(html).toContain("Recorded card charges");
		expect(html).not.toContain("No recorded cash payments in this period.");
		expect(html).not.toContain("No bills due in this period.");
		expect(html).toContain("125");
		expect(html).not.toContain("left-value");
		expect(html).not.toContain("spend-value");
		expect(html).not.toContain("perday-value");
		expect(html).not.toContain("Latest balance");
		expect(html).not.toContain("lucide-shield-check");
		expect(html).not.toContain("Cash balance 0");
	});
	it("keeps a populated cash payment list out of the card and available separately in the drawer", () => {
		const { view, section } = historicalFixture();
		const rows = Array.from({ length: 13 }, (_, index) => ({
			...section.transactions[0]!,
			id: `anonymous-payment-${index}`,
			transactionId: `anonymous-payment-${index}`,
			name: `Anonymous cash payment ${index}`,
			amount: 12.34,
		}));
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				heroes: { ...view.heroes, committedTotal: 125.67 },
				cashEvidence: "No balance recorded at close",
				section: { ...section, transactions: rows, total: 160.42 },
				closed: true,
			}),
		);
		expect(html).toContain('data-testid="recorded-charges-value"');
		expect(html).toContain("$125.67");
		expect(html).toContain("Cash payments");
		expect(html).toContain("$160.42");
		expect(html).not.toContain("Anonymous cash payment");
		expect(html).not.toContain("<details");
		const drawer = renderToStaticMarkup(
			createElement(SafeSpendingCyclePanel, {
				cycle: {
					start: "2026-09-20",
					end: "2026-10-19",
					title: "Recorded card charges",
					emptyMessage: "No card charges",
					transactions: [recordedCharge],
					showTotal: true,
				},
				cashPayments: { ...section, transactions: rows, total: 160.42 },
				accounts: [],
				transactions: [],
				readOnly: true,
				transactionOrder: "newest",
				onTransactionOrderChange: () => {},
			}),
		);
		expect(drawer).toContain("Synthetic purchase");
		expect(drawer).toContain("Anonymous cash payment 12");
		expect(drawer).toContain("Cash payments this cycle");
		expect(drawer).toContain("Sep 20 – Oct 19");
		expect(drawer).toContain("$125.00");
		expect(drawer).toContain("$160.42");
		expect(drawer).not.toContain("$285.42");
	});
});
