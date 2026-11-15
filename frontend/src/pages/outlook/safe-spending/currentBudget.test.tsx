import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { cycleView, type CycleViewInput } from "./cycleView.ts";
import {
	currentCashActivity,
	currentSpendingActivity,
} from "./currentCashActivity.ts";
import { transactionToDisplay } from "@/domain/transactionRows.ts";
import { TransactionSectionView } from "./TransactionSectionView.tsx";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";

vi.mock("../../../components/activity/TransactionRow.tsx", () => ({
	TransactionRow: ({
		transaction,
		divider,
	}: {
		transaction: AccountTransaction;
		divider?: { label: string };
	}) =>
		createElement(
			"tr",
			{ "data-spending-row": transaction.id },
			createElement(
				"td",
				null,
				transaction.name,
				divider && createElement("small", null, divider.label),
			),
		),
}));

function charge(id: string, amount: number, time: string): AccountTransaction {
	return {
		id,
		transactionId: id,
		date: "2026-11-09",
		sortDate: `2026-11-09T${time}Z`,
		name: id,
		source: "historical",
		direction: "out",
		flow: "expense",
		counterparty: "Merchant",
		from: "Synthetic card",
		to: "Merchant",
		amount,
		requested: amount,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
	};
}
const summary: SafeSpendingSummary = {
	start: "2026-11-15",
	end: "2026-11-30",
	status: "available",
	cashAfterBills: -216.58,
	checkingAvailable: 1244.43,
	outstandingBillsTotal: 1461.01,
	revision: "synthetic",
	baselines: [],
	confirmedMovements: [],
	outstandingObligations: [],
	reasons: [],
	selectedAccountIds: ["cash"],
};
const input: CycleViewInput = {
	cycle: { start: "2026-10-20", end: "2026-11-19" },
	referenceDay: "2026-11-15",
	cashSummary: summary,
	reserve: 700,
	fullDaysLeft: 4,
	closedCycle: {
		start: "2026-09-20",
		end: "2026-10-19",
		total: null,
		cards: [],
	},
	cardSpentByCard: [],
	transactions: [
		charge("third-charge", 200, "15:00:00"),
		charge("first-charge", 100, "10:00:00"),
		charge("second-charge", 200, "12:00:00"),
	],
};

describe("one cash-backed current spending budget", () => {
	it("keeps positive cash-backed allowance without restoring a spending bar", () => {
		const { view } = cycleView({
			...input,
			reserve: 0,
			cashSummary: { ...summary, cashAfterBills: 100 },
		});
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				cashEvidence: "Cash after bills 100",
				section: {
					title: "Cash payments",
					subtitle: "",
					total: 0,
					transactions: [],
				},
			}),
		);
		expect(html).toContain("$100.00");
		expect(html).not.toContain('aria-label="Spent');
		expect(html).not.toContain('role="img"');
	});
	it("reconciles cash, reserve, daily allowance, trend, and the exact second row", () => {
		const { view, trend, ledger } = cycleView(input);
		expect(view.heroes.theoretical).toBe(-216.58);
		expect(view.heroes.safe).toBe(-916.58);
		expect(view.heroes.dailySafe).toBe(-916.58 / 4);
		expect(view.allocation.allowance).toBe(-916.58);
		expect(trend.actual.at(-1)?.spent).toBe(500);
		expect(trend.limit).toBe(283.42);
		expect(trend.safetyNet).toBe(-416.58);
		expect(trend.limitHit).toMatchObject({
			transactionId: "second-charge",
			amount: 300,
		});
		expect(trend.safetyNetHit).toBeNull();
		expect(ledger.map((row) => row.id)).toEqual([
			"first-charge",
			"second-charge",
			"third-charge",
		]);
		const html = renderToStaticMarkup(
			createElement(SafeSpendingBillsPanel, {
				...view,
				trend: undefined,
				cashEvidence: "Cash after bills -216.58",
				section: {
					title: "Cash payments",
					subtitle: "",
					total: 0,
					transactions: [],
				},
			}),
		);
		expect(html).toContain("Over limit by $216.58");
		expect(html).not.toContain("$217");
	});
	it.each(["oldest", "newest"] as const)(
		"anchors the divider to the same row in %s order",
		(order) => {
			const result = cycleView(input);
			const rows =
				order === "oldest" ? result.ledger : [...result.ledger].reverse();
			const html = renderToStaticMarkup(
				createElement(TransactionSectionView, {
					transactions: rows,
					caption: "Spending",
					emptyMessage: "Empty",
					savedTransactions: new Map(),
					onInspect: () => {},
					order,
					dividers: [
						{
							transactionId: result.trend.limitHit!.transactionId!,
							tone: "danger",
							label: "Spending limit",
						},
					],
				}),
			);
			expect(html).toContain(
				'<tr data-spending-row="second-charge"><td>second-charge<small>Spending limit</small></td></tr>',
			);
			expect(html.match(/data-spending-row=/g)).toHaveLength(3);
			expect(html).not.toContain('role="separator"');
		},
	);
	it("does not cross at exact zero and crosses on the next cent", () => {
		const result = cycleView({
			...input,
			reserve: 0,
			cashSummary: { ...summary, cashAfterBills: -0.01 },
			transactions: [
				charge("exact-zero", 0.3, "10:00:00"),
				charge("one-cent", 0.01, "11:00:00"),
			],
		});
		expect(result.trend.limit).toBe(0.3);
		expect(result.trend.limitHit?.transactionId).toBe("one-cent");
	});
	it("retains the first crossing after a negative outflow refund and recrossing", () => {
		const rows = [
			charge("first-crossing", 100, "10:00:00"),
			charge("refund", -80, "11:00:00"),
			charge("recrossing", 100, "12:00:00"),
		];
		const result = cycleView({
			...input,
			transactions: rows,
			cashSummary: { ...summary, cashAfterBills: -70 },
		});
		expect(result.trend.limit).toBe(50);
		expect(result.trend.limitHit?.transactionId).toBe("first-crossing");
	});
	it.each([
		undefined,
		{ ...summary, status: "uncertain" },
		{ ...summary, cashAfterBills: null },
		{ ...summary, start: "2026-10-19", end: "2026-10-19" },
	])(
		"disables dependent thresholds and allowances without coherent current cash",
		(cashSummary) => {
			const result = cycleView({ ...input, cashSummary });
			expect(result.view.allocation.available).toBe(false);
			expect(result.trend.limit).toBeNull();
			expect(result.trend.safetyNet).toBeNull();
			expect(result.trend.limitHit).toBeNull();
		},
	);
	it("does not assign a causal transaction to an already negative opening capacity", () => {
		const result = cycleView({
			...input,
			transactions: [charge("not-the-cause", 20, "10:00:00")],
		});
		expect(result.trend.limit).toBe(-196.58);
		expect(result.trend.limitHit).toBeNull();
	});
	it("uses posted instants when transaction time is absent rather than same-day ID order", () => {
		const raw = (id: string, postedTime: number) =>
			transactionToDisplay({
				id,
				name: id,
				amount: {
					resolver: "expression",
					config: { expression: "100" },
					inputs: {},
				},
				sourceAccountId: "card",
				destinations: [],
				enabled: true,
				endDate: null,
				readOnly: true,
				startDate: "2026-11-09",
				syncOwned: false,
				postedTime,
			});
		const saved = [
			raw("z-earlier", Date.parse("2026-11-09T10:00:00Z") / 1000),
			raw("a-later", Date.parse("2026-11-09T12:00:00Z") / 1000),
		];
		const rows = saved.map((row) => ({
			...charge(row.id, 100, "00:00:00"),
			sortDate: undefined,
		}));
		const result = cycleView({
			...input,
			cashSummary: { ...summary, cashAfterBills: -50 },
			transactions: currentSpendingActivity(rows, saved),
		});
		expect(result.ledger.map((row) => row.id)).toEqual([
			"z-earlier",
			"a-later",
		]);
		expect(result.trend.limitHit?.transactionId).toBe("a-later");
		const precise = charge("z-earlier", 100, "09:00:01");
		expect(currentSpendingActivity([precise], saved)[0]).toBe(precise);
	});
});

describe("canonical recorded cash selection", () => {
	const account: Account = {
		id: "cash",
		name: "Synthetic cash",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 1244.43,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-11-15",
		balanceCheck: false,
		source: "manual",
		readOnly: false,
	};
	function cash(id: string, overrides: Partial<Transaction> = {}): Transaction {
		return {
			id,
			name: id,
			amount: 100,
			amountKnown: true,
			fromId: "cash",
			toId: null,
			kind: "transaction",
			startDate: "2026-11-09",
			endDate: null,
			annualIncrease: 0,
			enabled: true,
			readOnly: true,
			claimScheduleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			pending: false,
			void: false,
			...overrides,
		};
	}
	it("includes saved cash purchases after the checkpoint through today, never future rows", () => {
		const rows = currentCashActivity({
			accounts: [account],
			spendingIds: ["cash"],
			startDate: "2026-11-13",
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: "2026-11-15",
			billIds: [],
			ruleIds: [],
			transactions: [
				cash("after-checkpoint", { startDate: "2026-11-14" }),
				cash("today", { startDate: "2026-11-15" }),
				cash("future", { startDate: "2026-11-16" }),
				cash("after-checkpoint-disabled", {
					startDate: "2026-11-14",
					enabled: false,
				}),
			],
		});
		expect(rows.map((row) => row.transactionId).sort()).toEqual([
			"after-checkpoint",
			"today",
		]);
		expect(rows.every((row) => row.source === "historical")).toBe(true);
		const result = cycleView({ ...input, transactions: rows });
		expect(result.view.heroes.committedTotal).toBe(200);
		expect(result.trend.actual.at(-1)?.spent).toBe(200);
	});
	it("counts an overlapping tracked and cash selection once without merging distinct effects", () => {
		const saved = cash("overlapping-purchase");
		const direct = currentCashActivity({
			accounts: [account],
			transactions: [saved],
			spendingIds: [account.id],
			startDate: "2026-11-13",
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: input.referenceDay,
			billIds: [],
			ruleIds: [],
		});
		const result = cycleView({
			...input,
			cashSummary: { ...summary, cashAfterBills: -0.01 },
			transactions: [...direct, ...direct],
		});
		expect(result.ledger).toHaveLength(1);
		expect(new Set(result.ledger.map((row) => row.id)).size).toBe(1);
		expect(result.view.heroes.committedTotal).toBe(100);
		expect(result.trend.actual.at(-1)?.spent).toBe(100);
		expect(result.trend.limit).toBe(99.99);
		expect(result.trend.limitHit?.transactionId).toBe(direct[0]!.id);
		const split = {
			...direct[0]!,
			id: "distinct-account-effect",
			from: "Other synthetic cash",
			amount: 40,
		};
		const distinct = cycleView({
			...input,
			transactions: [...direct, ...direct, split],
		});
		expect(distinct.ledger).toHaveLength(2);
		expect(distinct.view.heroes.committedTotal).toBe(140);
	});
	it("keeps unknown external payments, excludes linked settlements/transfers and holds from spending", () => {
		const rows = currentCashActivity({
			accounts: [account],
			spendingIds: ["cash"],
			startDate: "2026-11-15",
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: input.referenceDay,
			billIds: ["rent-rule"],
			ruleIds: ["rent-rule"],
			transactions: [
				cash("external-payment"),
				cash("linked-card-payment", { toId: "card" }),
				cash("internal-transfer", { toId: "savings" }),
				cash("old-disabled-hold", {
					amount: 363.62,
					enabled: false,
					pending: true,
					syncOwned: true,
				}),
				cash("disabled", { enabled: false }),
				cash("void", { void: true }),
				cash("bill", { claimScheduleId: "rent-rule" }),
			],
		});
		expect(rows.map((row) => row.transactionId).sort()).toEqual([
			"external-payment",
			"internal-transfer",
			"linked-card-payment",
		]);
		const result = cycleView({
			...input,
			transactions: [...rows, charge("card-purchase", 100, "10:00:00")],
		});
		expect(result.ledger.map((row) => row.transactionId).sort()).toEqual([
			"card-purchase",
			"external-payment",
		]);
		expect(result.view.heroes.committedTotal).toBe(200);
		expect(result.view.heroes.theoretical).toBe(-216.58);
	});
});
