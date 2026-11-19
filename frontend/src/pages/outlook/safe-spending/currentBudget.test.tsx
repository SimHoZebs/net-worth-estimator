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
import {
	expectedMonthlyIncome,
	incomeSourceCandidates,
} from "@/domain/safeSpendingIncome.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import {
	paceLabel,
	SafeSpendingTrendChart,
} from "./SafeSpendingTrendChart.tsx";

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
	cardSpentByCard: [],
	transactions: [
		charge("third-charge", 200, "15:00:00"),
		charge("first-charge", 100, "10:00:00"),
		charge("second-charge", 200, "12:00:00"),
	],
};

describe("one cash-backed current spending budget", () => {
	it("keeps a positive cash-backed allowance in the model", () => {
		const { view } = cycleView({
			...input,
			reserve: 0,
			cashSummary: { ...summary, cashAfterBills: 100 },
		});
		expect(view.allocation.allowance).toBe(100);
	});
	it("reconciles cash, reserve, daily allowance, trend, and ledger", () => {
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
		expect(currentSpendingActivity([precise], saved)[0]).toMatchObject({
			...precise,
			spendingAmount: 100,
		});
	});
});

describe("monthly income comparison", () => {
	const dated = (id: string, amount: number, date: string) => ({
		...charge(id, amount, "10:00:00"),
		date,
		sortDate: `${date}T10:00:00Z`,
	});
	it("offsets previous-calendar-month cycle spending without comparing it with this month's income", () => {
		const result = cycleView({
			...input,
			monthlyIncome: 150,
			transactions: [
				dated("october", 1000, "2026-10-31"),
				dated("november-first", 100, "2026-11-01"),
				dated("november-hit", 60, "2026-11-02"),
			],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 150,
			spent: 160,
			coordinate: 150,
			start: "2026-11-01",
			hit: { transactionId: "november-hit", amount: 150 },
		});
		expect(result.view.heroes.theoretical).toBe(summary.cashAfterBills);
	});
	it("includes spending before cycle entry and does not blame the first visible row", () => {
		const result = cycleView({
			...input,
			cycle: { start: "2026-11-10", end: "2026-12-09" },
			monthlyIncome: 100,
			transactions: [
				dated("prior-hit", 120, "2026-11-02"),
				dated("visible", 10, "2026-11-11"),
			],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			spent: 130,
			coordinate: 100,
			start: "2026-11-10",
			hit: null,
		});
		expect(result.ledger.map((row) => row.id)).toEqual(["visible"]);
	});
	it("handles observed zero, exact same-day ordering, reversals, deduplication and pending", () => {
		const first = charge("first-positive", 0.01, "09:00:00");
		const result = cycleView({
			...input,
			monthlyIncome: 0,
			transactions: [
				charge("later", 100, "12:00:00"),
				first,
				first,
				charge("reversal", -0.01, "10:00:00"),
				{
					...charge("pending", 900, "08:00:00"),
					direction: "in",
					spendingAmount: -900,
					pending: true,
				},
			],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			spent: -800,
			hit: null,
		});
	});
	it("retains disabled pending card commitments and nets pending refunds", () => {
		const rows = currentSpendingActivity(
			[
				{
					...charge("pending-card", 17.05, "09:00:00"),
					pending: true,
					excluded: true,
				},
				{
					...charge("second-pending-card", 16.97, "10:00:00"),
					pending: true,
					excluded: true,
				},
				{
					...charge("pending-refund", 100, "11:00:00"),
					direction: "in",
					flow: "income",
					pending: true,
				},
			],
			[
				{
					id: "pending-refund",
					category: "GENERAL_MERCHANDISE",
				} as Transaction,
			],
		);
		const result = cycleView({
			...input,
			transactions: rows,
			monthlyIncome: 32.11,
		});
		expect(result.ledger.map((row) => row.id)).toEqual([
			"pending-card",
			"second-pending-card",
			"pending-refund",
		]);
		expect(result.view.heroes.committedTotal).toBe(-65.98);
		expect(result.trend.actual.at(-1)?.spent).toBe(-65.98);
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 32.11,
			spent: -65.98,
			hit: { transactionId: "second-pending-card" },
		});
	});
	it("keeps income and cash evidence independently available", () => {
		const incomeOnly = cycleView({
			...input,
			cashSummary: undefined,
			monthlyIncome: 100,
		});
		expect(incomeOnly.trend.limit).toBeNull();
		expect(incomeOnly.trend.monthlyIncome?.hit?.transactionId).toBe(
			"second-charge",
		);
		const cashOnly = cycleView({ ...input, monthlyIncome: null });
		expect(cashOnly.trend.limit).not.toBeNull();
		expect(cashOnly.trend.monthlyIncome).toBeUndefined();
	});
	it("shows the income threshold at the expected monthly pay", () => {
		const result = cycleView({
			...input,
			cycle: { start: "2026-10-20", end: "2026-11-19" },
			monthlyIncome: 7458.34,
			transactions: [
				{ ...charge("october", 4552.47, "09:00:00"), date: "2026-10-25" },
				charge("november", 4734.37, "10:00:00"),
			],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 7458.34,
			coordinate: 7458.34,
		});
		const markup = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, { trend: result.trend }),
		);
		expect(markup).toContain("Income limit");
	});
	it("warns about monthly overspending with savings left, or low cash with sufficient income", () => {
		const savings = cycleView({
			...input,
			monthlyIncome: 150,
			cashSummary: { ...summary, cashAfterBills: 2000 },
		});
		expect(savings.trend.monthlyIncome?.hit?.transactionId).toBe(
			"second-charge",
		);
		expect(savings.trend.limitHit).toBeNull();
		expect(savings.view.heroes.theoretical).toBe(2000);
		const lowCash = cycleView({
			...input,
			monthlyIncome: 1000,
			cashSummary: { ...summary, checkingAvailable: -750 },
		});
		expect(lowCash.trend.monthlyIncome?.hit).toBeNull();
		expect(lowCash.trend.limitHit?.transactionId).toBe("second-charge");
	});
	it("resets at the calendar boundary", () => {
		const result = cycleView({
			...input,
			referenceDay: "2026-12-01",
			cycle: { start: "2026-11-20", end: "2026-12-19" },
			monthlyIncome: 0,
			transactions: [
				dated("november", 100, "2026-11-30"),
				dated("december", 1, "2026-12-01"),
			],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			spent: 1,
			coordinate: 0,
			start: "2026-12-01",
			hit: { transactionId: "december" },
		});
	});
	it.each(["oldest", "newest"] as const)(
		"combines every coincident cutoff without adding rows in %s order",
		(order) => {
			const rows =
				order === "oldest"
					? input.transactions
					: [...input.transactions].reverse();
			const markup = renderToStaticMarkup(
				createElement(TransactionSectionView, {
					transactions: rows,
					caption: "Spending",
					emptyMessage: "Empty",
					savedTransactions: new Map(),
					onInspect: vi.fn(),
					order,
					dividers: [
						{
							transactionId: "second-charge",
							tone: "warning",
							label: "Earned this month",
						},
						{
							transactionId: "second-charge",
							tone: "warning",
							label: "Reserve",
						},
						{
							transactionId: "second-charge",
							tone: "danger",
							label: "Cash limit",
						},
					],
				}),
			);
			expect(markup).toContain("Earned this month · Reserve · Cash limit");
			expect(markup.match(/<tr/g)).toHaveLength(3);
		},
	);
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
		displayBasis: "available",
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
	const paycheck = (
		id: string,
		value: number,
		day: string,
		overrides: Partial<Schedule> = {},
	): Schedule => ({
		id,
		name: id,
		amount: {
			resolver: "expression",
			config: { expression: String(value) },
			inputs: {},
		},
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: day,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
		destinations: ["cash"],
		sourceAccountId: null,
		...overrides,
	});
	it("keeps the established shared cash candidate scope, including future starts", () => {
		const accounts = [
			account,
			{ ...account, id: "savings" },
			{ ...account, id: "disabled", enabled: false },
		];
		const rule = cash("salary", {
			kind: "schedule",
			fromId: null,
			toId: "savings",
		});
		const rules = [
			rule,
			{ ...rule, id: "future-start", startDate: "2026-12-01" },
			{ ...rule, id: "ended", endDate: "2026-10-31" },
			{ ...rule, id: "disabled", enabled: false },
			{ ...rule, id: "wrong-destination", toId: "cash" },
			{ ...rule, id: "internal", fromId: "savings" },
			{ ...rule, id: "invalid-source", fromId: "disabled" },
		];
		expect(
			incomeSourceCandidates({
				accounts,
				rules,
				spendingIds: ["savings"],
				today: input.referenceDay,
			}).map((item) => item.id),
		).toEqual(["salary", "future-start"]);
	});
	it("counts every selected November occurrence, including end-of-month pay outside the statement cycle", () => {
		const schedules = [
			paycheck("payroll", 7458.34, "2026-11-30"),
			paycheck("midmonth", 100, "2026-11-08"),
			paycheck("unselected", 999, "2026-11-15"),
			paycheck("december-only", 500, "2026-12-01"),
		];
		const args = {
			schedules,
			monthStart: "2026-11-01",
			monthEnd: "2026-11-30",
		};
		expect(
			expectedMonthlyIncome({
				...args,
				incomeScheduleIds: ["payroll", "midmonth"],
			}),
		).toBe(7558.34);
		expect(
			expectedMonthlyIncome({ ...args, incomeScheduleIds: ["payroll"] }),
		).toBe(7458.34);
		expect(
			expectedMonthlyIncome({ ...args, incomeScheduleIds: [] }),
		).toBeNull();
		expect(
			expectedMonthlyIncome({ ...args, incomeScheduleIds: ["missing"] }),
		).toBeNull();
		expect(
			expectedMonthlyIncome({
				...args,
				incomeScheduleIds: ["december-only"],
			}),
		).toBe(0);
		expect(
			expectedMonthlyIncome({
				schedules: [
					paycheck("varies", 0, "2026-11-30", {
						amount: { resolver: "expression", config: {}, inputs: {} },
					}),
				],
				monthStart: "2026-11-01",
				monthEnd: "2026-11-30",
				incomeScheduleIds: ["varies"],
			}),
		).toBeNull();
	});
	it("keeps an ended or disabled selected source's scheduled November occurrences", () => {
		for (const override of [
			{ startDate: "2026-10-05", endDate: "2026-11-10" },
			{ startDate: "2026-11-08", enabled: false },
		]) {
			const schedules = [paycheck("payroll", 100, "2026-11-08", override)];
			expect(
				expectedMonthlyIncome({
					schedules,
					incomeScheduleIds: ["payroll"],
					monthStart: "2026-11-01",
					monthEnd: "2026-11-30",
				}),
			).toBe(100);
		}
	});
	it("subtracts categorized refunds once without turning them into income or changing cash", () => {
		const transactions = [
			cash("income", {
				claimScheduleId: "payroll",
				fromId: null,
				toId: "cash",
				amount: 50,
				category: "INCOME",
				categorySource: "bank",
			}),
			cash("purchase", { amount: 100, category: "GENERAL_MERCHANDISE" }),
			cash("refund", {
				fromId: null,
				toId: "cash",
				amount: 100,
				category: "GENERAL_MERCHANDISE",
				categorySource: "user",
			}),
			cash("transfer-in", {
				amount: 900,
				category: "TRANSFER_IN",
				fromId: null,
				toId: "cash",
			}),
		];
		const rows = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			transactions,
		);
		const result = cycleView({
			...input,
			transactions: rows,
			monthlyIncome: 50,
		});
		expect(result.trend.monthlyIncome).toMatchObject({ amount: 50, spent: 0 });
		expect(result.trend.actual.at(-1)?.spent).toBe(0);
		expect(result.view.heroes.committedTotal).toBe(0);
		expect(result.view.heroes.theoretical).toBe(summary.cashAfterBills);
		expect(result.ledger.map((row) => row.transactionId)).toEqual([
			"purchase",
			"refund",
		]);
		expect(
			result.ledger.find((row) => row.transactionId === "refund"),
		).toMatchObject({ amount: 100, direction: "in", spendingAmount: -100 });
		expect(
			rows.find((row) => row.transactionId === "transfer-in")?.spendingAmount,
		).toBe(0);
		const outgoing = cash("transfer-out", {
			amount: 900,
			category: "TRANSFER_OUT",
			toId: null,
		});
		const external = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions: [outgoing],
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			[outgoing],
		);
		expect(
			cycleView({ ...input, transactions: external }).view.heroes
				.committedTotal,
		).toBe(900);
	});
	it("excludes card settlements from the purchase budget while keeping them inspectable", () => {
		const settlement = cash("Payment to Chase card ending in 4001 10/30", {
			amount: 271.74,
		});
		const rows = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions: [settlement],
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			[settlement],
		);
		expect(rows[0]?.flow).toBe("transfer");
		expect(rows[0]?.spendingAmount).toBe(0);
		expect(
			cycleView({ ...input, transactions: rows }).view.heroes.committedTotal,
		).toBe(0);
	});
	it("sets the limit to income plus cash in account, ignoring spent", () => {
		const result = cycleView({ ...input, monthlyIncome: 150 });
		expect(result.trend.limit).toBe(1394.43);
		expect(result.trend.safetyNet).toBe(694.43);
		expect(result.trend.limitHit).toBeNull();
		const crossing = cycleView({
			...input,
			monthlyIncome: 100,
			cashSummary: { ...summary, checkingAvailable: 100 },
		});
		expect(crossing.trend.limit).toBe(200);
		expect(crossing.trend.limitHit).toMatchObject({
			transactionId: "second-charge",
			amount: 300,
		});
	});
	it("falls back to spent plus cash after bills without selected income", () => {
		const base = cycleView(input);
		expect(base.trend.limit).toBe(283.42);
		const explicitNull = cycleView({ ...input, monthlyIncome: null });
		expect(explicitNull.trend.limit).toBe(283.42);
	});
	it("sums selected November schedules into one expected pay figure", () => {
		const schedules = [
			paycheck("payroll", 100, "2026-11-08"),
			paycheck("bonus", 80, "2026-11-15"),
			paycheck("unselected", 999, "2026-11-20"),
		];
		const income = expectedMonthlyIncome({
			schedules,
			incomeScheduleIds: ["payroll", "bonus"],
			monthStart: "2026-11-01",
			monthEnd: "2026-11-30",
		});
		expect(income).toBe(180);
		const result = cycleView({
			...input,
			monthlyIncome: income,
			transactions: [],
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 180,
			spent: 0,
			coordinate: 180,
			hit: null,
		});
		expect(result.view.heroes.theoretical).toBe(summary.cashAfterBills);
	});
	it.each(["expense", "refund"])(
		"keeps income and cash values while an unresolved monthly %s disables the income ceiling",
		(kind) => {
			const transactions = [
				cash("income", {
					claimScheduleId: "payroll",
					fromId: null,
					toId: "cash",
					amount: 100,
					category: "INCOME",
				}),
				cash("unknown", {
					startDate: "2026-11-02",
					amount: 0,
					amountKnown: false,
					category: "GENERAL_MERCHANDISE",
					...(kind === "refund" ? { fromId: null, toId: "cash" } : {}),
				}),
			];
			const rows = currentSpendingActivity(
				currentCashActivity({
					accounts: [account],
					transactions,
					spendingIds: ["cash"],
					cycleStart: "2026-11-01",
					cycleEnd: "2026-12-09",
					today: input.referenceDay,
				}),
				transactions,
			);
			const result = cycleView({
				...input,
				cycle: { start: "2026-11-10", end: "2026-12-09" },
				transactions: rows,
				cashSummary: { ...summary, cashAfterBills: 183.42 },
				monthlyIncome: 100,
			});
			expect(result.trend.monthlyIncome).toMatchObject({
				amount: 100,
				spent: null,
				coordinate: null,
				hit: null,
			});
			expect(result.view.heroes.theoretical).toBe(183.42);
			expect(result.trend.limit).toBe(1344.43);
		},
	);
	it("suppresses incomplete current-cycle spending claims while preserving known income and cash", () => {
		const transactions = [
			cash("unknown-expense", {
				amount: 0,
				amountKnown: false,
				startDate: "2026-11-12",
			}),
		];
		const rows = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			transactions,
		);
		const result = cycleView({
			...input,
			transactions: rows,
			cashSummary: { ...summary, cashAfterBills: 40 },
			monthlyIncome: 100,
		});
		expect(result.view.heroes.theoretical).toBe(40);
		expect(result.view.heroes.committedTotal).toBeNull();
		expect(result.trend).toMatchObject({
			spendingAvailable: false,
			actual: [],
			projected: [],
			monthlyIncome: { amount: 100, spent: null, coordinate: null },
		});
		const html = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, { trend: result.trend }),
		);
		expect(html).toContain("Spending incomplete");
		expect(html).not.toContain("Income this month");
		expect(html).not.toContain("Spending reached");
		expect(html).not.toContain("$0.00");
		expect(html).not.toContain("a day");
		expect(html).not.toContain("Projected");
		expect(html).not.toContain("<svg");
	});
	it("keeps a known zero expense valid and ignores unknown future or unselected expenses", () => {
		const transactions = [
			cash("income", {
				fromId: null,
				toId: "cash",
				amount: 100,
				category: "INCOME",
			}),
			cash("zero", { amount: 0 }),
			cash("future", {
				amount: 0,
				amountKnown: false,
				startDate: "2026-11-16",
			}),
			cash("other-account", { amount: 0, amountKnown: false, fromId: "other" }),
		];
		const rows = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			transactions,
		);
		const result = cycleView({
			...input,
			transactions: rows,
			monthlyIncome: 100,
		});
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 100,
			spent: 0,
			coordinate: 100,
			hit: null,
		});
	});
	it("clears current cash and reserve warnings after a refund without losing the original crossing", () => {
		const transactions = [
			cash("purchase", { amount: 60 }),
			cash("refund", {
				fromId: null,
				toId: "cash",
				amount: 50,
				category: "GENERAL_MERCHANDISE",
			}),
		];
		const rows = currentSpendingActivity(
			currentCashActivity({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				cycleStart: input.cycle.start,
				cycleEnd: input.cycle.end,
				today: input.referenceDay,
			}),
			transactions,
		);
		const result = cycleView({
			...input,
			transactions: rows,
			reserve: 0,
			cashSummary: { ...summary, cashAfterBills: 40, checkingAvailable: -50 },
			monthlyIncome: 100,
		});
		expect(result.view.heroes.theoretical).toBe(40);
		expect(result.trend.actual.at(-1)?.spent).toBe(10);
		expect(result.trend.limitHit?.transactionId).toBe("recorded-purchase");
		expect(paceLabel({ ...result.trend, projected: [] })).toEqual({
			text: null,
			tone: "normal",
		});
	});
	it("includes saved cash purchases after the checkpoint through today, never future rows", () => {
		const rows = currentCashActivity({
			accounts: [account],
			spendingIds: ["cash"],
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: "2026-11-15",
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
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: input.referenceDay,
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
			cycleStart: input.cycle.start,
			cycleEnd: input.cycle.end,
			today: input.referenceDay,
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
			"bill",
			"external-payment",
			"internal-transfer",
			"linked-card-payment",
		]);
		const result = cycleView({
			...input,
			transactions: [...rows, charge("card-purchase", 100, "10:00:00")],
		});
		expect(result.ledger.map((row) => row.transactionId).sort()).toEqual([
			"bill",
			"card-purchase",
			"external-payment",
		]);
		expect(result.view.heroes.committedTotal).toBe(300);
		expect(result.view.heroes.theoretical).toBe(-216.58);
	});
});
