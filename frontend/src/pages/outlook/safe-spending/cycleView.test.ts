import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { cycleView, type CycleViewInput } from "./cycleView.ts";
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

function summary(
	overrides: Partial<SafeSpendingSummary> = {},
): SafeSpendingSummary {
	return {
		revision: "synthetic",
		selectedAccountIds: ["checking"],
		start: "2026-11-15",
		end: "2026-11-30",
		status: "available",
		reasons: [],
		checkingAvailable: 1244.43,
		outstandingBillsTotal: 0,
		cashAfterBills: 400,
		baselines: [],
		confirmedMovements: [],
		outstandingObligations: [],
		...overrides,
	};
}

function selectedInput(
	overrides: Partial<CycleViewInput> = {},
): CycleViewInput {
	return {
		cycle: { start: "2026-09-20", end: "2026-10-19" },
		referenceDay: "2026-10-19",
		transactions: [recordedCharge],
		cashSummary: summary({
			start: "2026-10-19",
			end: "2026-10-19",
			cashAfterBills: 400,
			checkingAvailable: 525,
		}),
		cardSpentByCard: [{ id: "card", name: "Test card", amount: 125 }],
		reserve: 0,
		fullDaysLeft: 1,
		remainingOverride: 400,
		...overrides,
	};
}

describe("single selected-cycle budget", () => {
	it("reconstructs the same budget rows for a past window from close cash", () => {
		const { view, trend } = cycleView(selectedInput());
		expect(view.heroes.theoretical).toBe(400);
		expect(view.heroes.committedTotal).toBe(125);
		expect(view.allocation.available).toBe(true);
		expect(trend.actual.at(-1)?.spent).toBe(125);
		expect(trend.limit).toBe(525);
		expect(trend.safetyNet).toBe(525);
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Known cash evidence",
			}),
		);
		expect(html).toContain("Known cash evidence");
		expect(html).not.toContain("Card allowance");
		expect(html).not.toContain("paycheck");
		expect(html).not.toContain("this statement");
		expect(html).not.toContain("closed-card-value");
		expect(html).not.toContain("recorded-charges-value");
		expect(html).not.toContain("cash-payments-value");
		expect(html).not.toContain("Closed card balance");
	});
	it("uses the override remainder instead of the current-range shape", () => {
		const shaped = cycleView({
			...selectedInput(),
			remainingOverride: undefined,
		});
		expect(shaped.view.allocation.available).toBe(false);
		expect(shaped.trend.limit).toBeNull();
		const overridden = cycleView(selectedInput({ remainingOverride: null }));
		expect(overridden.view.allocation.available).toBe(false);
		expect(overridden.trend.limit).toBeNull();
		const restored = cycleView(selectedInput({ remainingOverride: 400 }));
		expect(restored.view.allocation.available).toBe(true);
		expect(restored.trend.limit).toBe(525);
	});
	it("renders the same main-card sections for an unavailable future window", () => {
		const { view } = cycleView(
			selectedInput({
				cycle: { start: "2026-11-20", end: "2026-12-19" },
				referenceDay: "2026-11-15",
				transactions: [],
				cardSpentByCard: [],
				remainingOverride: null,
				cashSummary: summary({
					start: "2026-12-19",
					end: "2026-12-19",
					status: "missing",
					cashAfterBills: null,
					checkingAvailable: null,
					baselines: [],
				}),
			}),
		);
		expect(view.allocation.available).toBe(false);
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Remainder unavailable",
			}),
		);
		expect(html).toContain("Remainder unavailable");
		expect(html).not.toContain("closed-card-value");
		expect(html).not.toContain("recorded-charges-value");
		expect(html).not.toContain("cash-payments-value");
		expect(html).not.toContain(
			"No cash evidence exists for an upcoming cycle.",
		);
	});
	it("captions the selected closed cycle rather than the current closing countdown", () => {
		expect(
			cycleCaption({
				start: "2026-09-20",
				end: "2026-10-19",
				closed: true,
				upcoming: false,
				daysLeft: 4,
			}),
		).toBe("Sep 20, 2026 – Oct 19, 2026 · Closed");
		expect(
			cycleCaption({
				start: "2026-11-20",
				end: "2026-12-19",
				closed: false,
				upcoming: true,
				daysLeft: 4,
			}),
		).toBe("Nov 20, 2026 – Dec 19, 2026 · Upcoming");
		expect(
			cycleCaption({
				start: "2026-10-20",
				end: "2026-11-19",
				closed: false,
				upcoming: false,
				daysLeft: 4,
			}),
		).toBe("Nov 19, 2026 · 4 days left");
	});
	it("keeps one side-panel shape with spending, thresholds, and cash payments", () => {
		const { view, trend } = cycleView(selectedInput({ monthlyIncome: 600 }));
		expect(trend.monthlyIncome?.amount).toBe(600);
		const cashRow: AccountTransaction = {
			...recordedCharge,
			id: "cash-payment",
			transactionId: "cash-payment",
			name: "Recorded card payment",
			flow: "transfer",
		};
		const section = {
			title: "Cash payments this cycle",
			subtitle: "Recorded amounts · Sep 20 – Oct 19",
			total: 80,
			transactions: [cashRow],
		};
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Known cash evidence",
			}),
		);
		expect(html).not.toContain("Cash payments");
		expect(html).not.toContain("$80.00");
		const drawer = renderToStaticMarkup(
			createElement(SafeSpendingCyclePanel, {
				cycle: {
					start: "2026-09-20",
					end: "2026-10-19",
					title: "Spending this cycle",
					emptyMessage: "No spending this cycle yet.",
					transactions: [recordedCharge],
					summary: {
						total: view.heroes.committedTotal,
						byCard: view.heroes.committedByCard,
					},
					thresholds: {
						limitTransactionId: trend.limitHit?.transactionId ?? null,
						safetyNetTransactionId: trend.safetyNetHit?.transactionId ?? null,
						incomeTransactionId:
							trend.monthlyIncome?.hit?.transactionId ?? null,
					},
				},
				cashPayments: section,
				accounts: [],
				transactions: [],
				readOnly: true,
				transactionOrder: "newest",
				onTransactionOrderChange: () => {},
			}),
		);
		expect(drawer).toContain("Spending this cycle");
		expect(drawer).toContain("Synthetic purchase");
		expect(drawer).toContain("Recorded card payment");
		expect(drawer).toContain("Cash payments this cycle");
		expect(drawer).toContain("Sep 20 – Oct 19");
		expect(drawer).toContain("$125.00");
		expect(drawer).toContain("$80.00");
		expect(drawer).not.toContain("$205.00");
	});
	it("maps a past selected window to the cycle-end month for income", () => {
		const septemberCharge: AccountTransaction = {
			...recordedCharge,
			id: "september-charge",
			transactionId: "september-charge",
			date: "2026-09-25",
			name: "September purchase",
			amount: 200,
			requested: 200,
		};
		const { trend } = cycleView(
			selectedInput({
				monthlyIncome: 600,
				transactions: [septemberCharge, recordedCharge],
			}),
		);
		expect(trend.monthlyIncome).toMatchObject({
			amount: 600,
			start: "2026-10-01",
			end: "2026-10-19",
			spent: 125,
		});
	});
	it("maps a future selected window to the display month for income", () => {
		const octoberCharge: AccountTransaction = {
			...recordedCharge,
			id: "october-charge",
			transactionId: "october-charge",
			date: "2026-10-25",
			name: "October purchase",
			amount: 200,
			requested: 200,
		};
		const novemberCharge: AccountTransaction = {
			...recordedCharge,
			id: "november-charge",
			transactionId: "november-charge",
			date: "2026-11-10",
			name: "November purchase",
			amount: 80,
			requested: 80,
		};
		const { trend } = cycleView(
			selectedInput({
				cycle: { start: "2026-11-20", end: "2026-12-19" },
				referenceDay: "2026-11-15",
				transactions: [octoberCharge, novemberCharge],
				monthlyIncome: 600,
			}),
		);
		expect(trend.monthlyIncome).toMatchObject({
			amount: 600,
			start: "2026-11-20",
			end: "2026-11-30",
			spent: 80,
		});
	});
});
