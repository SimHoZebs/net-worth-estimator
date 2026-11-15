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
	receivedMonthlyIncome,
} from "./currentCashActivity.ts";
import { transactionToDisplay } from "@/domain/transactionRows.ts";
import { TransactionSectionView } from "./TransactionSectionView.tsx";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
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
			coordinate: 1150,
			start: "2026-11-01",
			hit: { transactionId: "november-hit", amount: 1160 },
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
			coordinate: -20,
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
			spent: 100,
			hit: { transactionId: "first-positive", amount: 0.01 },
		});
	});
	it("retains disabled pending card commitments without crediting pending refunds or income", () => {
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
		]);
		expect(result.view.heroes.committedTotal).toBe(34.02);
		expect(result.trend.actual.at(-1)?.spent).toBe(34.02);
		expect(result.trend.monthlyIncome).toMatchObject({
			amount: 32.11,
			spent: 34.02,
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
		const lowCash = cycleView({ ...input, monthlyIncome: 1000 });
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
			coordinate: 100,
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
	it("uses posted external income only, independent of checkpoint and future schedules", () => {
		const evidence = {
			accounts: [account],
			spendingIds: ["cash", "cash"],
			today: input.referenceDay,
			transactions: [
				cash("income", {
					fromId: null,
					toId: "cash",
					amount: 500,
					category: "INCOME",
					categorySource: "user",
					startDate: "2026-11-14",
				}),
				cash("future", {
					fromId: null,
					toId: "cash",
					amount: 9000,
					startDate: "2026-11-16",
				}),
				cash("pending", {
					fromId: null,
					toId: "cash",
					pending: true,
					category: "INCOME",
				}),
				cash("void", { fromId: null, toId: "cash", void: true }),
				cash("transfer", { fromId: "savings", toId: "cash" }),
				cash("loan", { fromId: "loan", toId: "cash" }),
				cash("refund", {
					fromId: null,
					toId: "cash",
					category: "GENERAL_MERCHANDISE",
					categorySource: "bank",
				}),
				cash("unrouted-transfer", {
					fromId: null,
					toId: "cash",
					category: "TRANSFER_IN",
					categorySource: "bank",
				}),
				cash("routed-income", {
					fromId: "savings",
					toId: "cash",
					category: "INCOME",
				}),
				cash("old-month", {
					fromId: null,
					toId: "cash",
					startDate: "2026-10-31",
				}),
			],
		};
		expect(receivedMonthlyIncome(evidence)).toBe(500);
		expect(receivedMonthlyIncome({ ...evidence, transactions: [] })).toBe(0);
		expect(receivedMonthlyIncome({ ...evidence, spendingIds: [] })).toBeNull();
		expect(
			receivedMonthlyIncome({
				...evidence,
				transactions: [cash("unclassified", { fromId: null, toId: "cash" })],
			}),
		).toBeNull();
		expect(
			receivedMonthlyIncome({
				...evidence,
				transactions: [
					cash("unknown", {
						fromId: null,
						toId: "cash",
						amountKnown: false,
						category: "INCOME",
					}),
				],
			}),
		).toBeNull();
	});
	it("subtracts categorized refunds once without turning them into income or changing cash", () => {
		const transactions = [
			cash("income", {
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
			monthlyIncome: receivedMonthlyIncome({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				today: input.referenceDay,
			}),
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
	it.each([
		[100, 80],
		[10, -10],
	])(
		"nets categorized income reversals from a %s deposit without counting spending",
		(deposit, expected) => {
			const transactions = [
				cash("deposit", {
					fromId: null,
					toId: "cash",
					amount: deposit,
					category: "INCOME",
					categorySource: "user",
				}),
				cash("clawback", {
					amount: 20,
					category: "INCOME",
					categorySource: "bank",
				}),
			];
			const income = receivedMonthlyIncome({
				accounts: [account],
				transactions,
				spendingIds: ["cash"],
				today: input.referenceDay,
			});
			expect(income).toBe(expected);
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
				monthlyIncome: income,
				transactions: rows,
			});
			expect(result.trend.monthlyIncome).toMatchObject({
				amount: expected,
				spent: 0,
				coordinate: expected,
				hit: null,
			});
			expect(result.ledger).toHaveLength(0);
			expect(result.view.heroes.theoretical).toBe(summary.cashAfterBills);
		},
	);
	it.each(["expense", "refund"])(
		"keeps income and cash values while an unresolved monthly %s disables the income ceiling",
		(kind) => {
			const transactions = [
				cash("income", {
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
				monthlyIncome: receivedMonthlyIncome({
					accounts: [account],
					transactions,
					spendingIds: ["cash"],
					today: input.referenceDay,
				}),
			});
			expect(result.trend.monthlyIncome).toMatchObject({
				amount: 100,
				spent: null,
				coordinate: null,
				hit: null,
			});
			expect(result.view.heroes.theoretical).toBe(183.42);
			expect(result.trend.limit).toBe(183.42);
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
		expect(html).toContain("Income this month");
		expect(html).toContain("$100.00");
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
			cashSummary: { ...summary, cashAfterBills: 40 },
			monthlyIncome: 100,
		});
		expect(result.view.heroes.theoretical).toBe(40);
		expect(result.trend.actual.at(-1)?.spent).toBe(10);
		expect(result.trend.limitHit?.transactionId).toBe("recorded-purchase");
		expect(paceLabel({ ...result.trend, projected: [] }, false)).toEqual({
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
