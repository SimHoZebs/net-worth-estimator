import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { activityProjection } from "../mocks/projection.ts";
import type { Transaction } from "./model.ts";
import {
	accountTransactions,
	defaultActivityFilters,
	filterTransactions,
	voidSettleCandidates,
} from "./accountActivity.ts";

const projection = activityProjection();
const { accounts, transactions, startDate } = financialModelFixture;

describe("account-scoped transactions", () => {
	it("includes recorded history and the dated projected occurrences belonging to an account", () => {
		const rows = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection,
		});
		expect(rows.filter((row) => row.source === "historical")).toHaveLength(3);
		expect(rows.some((row) => row.transactionId === "renovation")).toBe(true);
		expect(
			rows.filter((row) => row.transactionId === "invest").length,
		).toBeGreaterThan(100);
		expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
	});

	it("does not duplicate recorded evidence from server events on or before the projection start", () => {
		const source = projection.transactions.find(
			(transaction) =>
				transaction.fromId === "checking" || transaction.toId === "checking",
		);
		if (!source) throw new Error("Expected a checking transaction fixture.");
		const historical = {
			...source,
			transactionId: "historical-server-event",
			date: startDate,
		};
		const rows = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection: {
				...projection,
				transactions: [historical, ...projection.transactions],
			},
		});
		expect(
			rows.some((row) => row.transactionId === "historical-server-event"),
		).toBe(false);
	});

	it("shows the same transfer as money out of the source and money into the destination", () => {
		const checking = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection,
		});
		const brokerage = accountTransactions({
			accountId: "brokerage",
			accounts,
			transactions,
			startDate,
			projection,
		});
		const outgoing = checking.find((row) => row.transactionId === "invest");
		const incoming = brokerage.find((row) => row.transactionId === "invest");
		expect(outgoing).toMatchObject({
			category: "transfer",
			direction: "out",
		});
		expect(incoming).toMatchObject({
			category: "transfer",
			direction: "in",
		});
		expect(incoming?.amount).toBe(outgoing?.amount);
		expect(incoming?.counterparty).toBe(outgoing?.from);
	});

	it("includes secondary destinations from server account deltas", () => {
		const source = projection.transactions.find(
			(transaction) => transaction.transactionId === "invest",
		);
		if (!source) throw new Error("Expected an investment transaction fixture.");
		const multi = {
			...source,
			transactionId: "multi-destination",
			requested: 100,
			realized: 100,
			accountDeltas: [
				{ accountId: "checking", delta: -100 },
				{ accountId: "brokerage", delta: 60 },
				{ accountId: "savings", delta: 40 },
			],
		};
		const rows = accountTransactions({
			accountId: "savings",
			accounts,
			transactions,
			startDate,
			projection: { ...projection, transactions: [multi] },
		});
		expect(rows).toContainEqual(
			expect.objectContaining({
				transactionId: "multi-destination",
				direction: "in",
				category: "transfer",
				amount: 40,
			}),
		);
	});

	it("preserves requested and funded amounts and the reason for a shortfall", () => {
		const rows = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection,
		});
		const failure = rows.find((row) => row.transactionId === "renovation");
		expect(failure?.requested).toBe(48000);
		expect(failure?.amount).toBeLessThan(48000);
		expect(failure?.shortfall).toBeCloseTo(48000 - (failure?.amount ?? 0));
		expect(typeof failure?.constraint).toBe("string");
	});

	it("keeps excluded recorded facts visible and excludes disabled planned rules", () => {
		const data = structuredClone(financialModelFixture);
		for (const transaction of data.transactions) {
			if (transaction.id === "pay-record-0" || transaction.id === "invest")
				transaction.enabled = false;
		}
		const rows = accountTransactions({
			accountId: "checking",
			accounts: data.accounts,
			transactions: data.transactions,
			startDate: data.startDate,
			projection: activityProjection(data),
		});
		expect(
			rows.find((row) => row.transactionId === "pay-record-0")?.excluded,
		).toBe(true);
		expect(rows.some((row) => row.transactionId === "invest")).toBe(false);
	});

	it("flags sync pending charges instead of reporting them as user-excluded", () => {
		const data = structuredClone(financialModelFixture);
		data.transactions.push({
			id: "01900000-0000-7000-8000-000000000001",
			name: "Mock Corner Store",
			pending: true,
			amount: 42.1,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: data.startDate,
			endDate: null,
			annualIncrease: 0,
			enabled: false,
			readOnly: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			void: false,
			syncOwned: true,
		});
		const rows = accountTransactions({
			accountId: "checking",
			accounts: data.accounts,
			transactions: data.transactions,
			startDate: data.startDate,
			projection: activityProjection(data),
		});
		expect(
			rows.find(
				(row) => row.transactionId === "01900000-0000-7000-8000-000000000001",
			),
		).toMatchObject({
			pending: true,
			excluded: false,
		});
	});

	it("marks holds that did not post without pending status", () => {
		const data = structuredClone(financialModelFixture);
		data.transactions.push({
			id: "01900000-0000-7000-8000-000000000002",
			name: "Hold that did not post",
			pending: false,
			void: true,
			amount: 42.1,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: data.startDate,
			endDate: null,
			annualIncrease: 0,
			enabled: false,
			readOnly: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			syncOwned: true,
		});
		const rows = accountTransactions({
			accountId: "checking",
			accounts: data.accounts,
			transactions: data.transactions,
			startDate: data.startDate,
			projection: activityProjection(data),
		});
		expect(
			rows.find(
				(row) => row.transactionId === "01900000-0000-7000-8000-000000000002",
			),
		).toMatchObject({
			pending: false,
			void: true,
			excluded: false,
		});
	});

	it.each([
		"01900000-0000-7000-8000-000000000001",
		"550e8400-e29b-41d4-a716-446655440000",
	])(
		"keeps pending UUID %s after the balance check visible without projecting it",
		(id) => {
			const data = structuredClone(financialModelFixture);
			data.transactions.push({
				...data.transactions[0]!,
				id,
				amount: 42.1,
				fromId: "checking",
				toId: null,
				frequency: "once",
				startDate: "2026-09-25",
				enabled: false,
				readOnly: true,
				pending: true,
			});
			const fixtureProjection = activityProjection(data);
			const rows = accountTransactions({
				accountId: "checking",
				accounts: data.accounts,
				transactions: data.transactions,
				startDate: data.startDate,
				projection: fixtureProjection,
			});
			expect(rows.filter((row) => row.transactionId === id)).toEqual([
				expect.objectContaining({
					date: "2026-09-25",
					amount: 42.1,
					source: "historical",
					pending: true,
					excluded: true,
				}),
			]);
			expect(
				fixtureProjection.transactions.some((row) => row.transactionId === id),
			).toBe(false);
			expect(
				data.transactions.find((transaction) => transaction.id === id)?.enabled,
			).toBe(false);
		},
	);

	it("has no manufactured transactions for growth-only or unknown accounts", () => {
		expect(
			accountTransactions({
				accountId: "home",
				accounts,
				transactions,
				startDate,
				projection,
			}),
		).toEqual([]);
		expect(
			accountTransactions({
				accountId: "missing",
				accounts,
				transactions,
				startDate,
				projection,
			}),
		).toEqual([]);
	});

	it("omits zero-value scheduled payments after a debt has been paid off", () => {
		const rows = accountTransactions({
			accountId: "mortgage",
			accounts,
			transactions,
			startDate,
			projection,
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.requested > 0)).toBe(true);
		expect(rows.every((row) => row.direction === "in")).toBe(true);
	});
});

describe("transaction filtering", () => {
	const rows = accountTransactions({
		accountId: "checking",
		accounts,
		transactions,
		startDate,
		projection,
	});
	const apply = (filters: Partial<typeof defaultActivityFilters>) =>
		filterTransactions({
			transactions: rows,
			startDate: startDate,
			filters: { ...defaultActivityFilters, ...filters },
		});

	it("searches both transaction names and the other account", () => {
		expect(apply({ query: "RENOVATION" })).toHaveLength(1);
		const investCounterparty = rows.find(
			(row) => row.transactionId === "invest",
		)?.counterparty;
		if (!investCounterparty) throw new Error("Expected an invest counterparty");
		expect(
			apply({ query: investCounterparty }).every(
				(row) => row.transactionId === "invest",
			),
		).toBe(true);
		expect(apply({ query: "no matching record" })).toEqual([]);
	});

	it("separates recorded facts, projected activity and direction", () => {
		expect(apply({ source: "historical" })).toHaveLength(3);
		expect(
			apply({ direction: "transfer" }).every(
				(row) => row.category === "transfer",
			),
		).toBe(true);
		expect(
			apply({ direction: "out" }).every((row) => row.direction === "out"),
		).toBe(true);
		expect(apply({ source: "historical", direction: "out" })).toHaveLength(0);
	});

	it("filters the next 30 days from the saved start date rather than the wall clock", () => {
		const rows = apply({ period: "30-days" });
		expect(rows).toHaveLength(5);
		expect(
			rows.every((row) => row.date > "2026-09-24" && row.date <= "2026-10-24"),
		).toBe(true);
	});

	it("sorts without mutating the complete transaction set", () => {
		const before = JSON.stringify(transactions);
		const rows = apply({ source: "historical", order: "newest" });
		expect(rows.map((row) => row.date)).toEqual([
			"2026-08-28",
			"2026-07-28",
			"2026-06-28",
		]);
		expect(JSON.stringify(transactions)).toBe(before);
	});
});

describe("bank evidence statuses", () => {
	function recordedModel() {
		const model = structuredClone(financialModelFixture);
		model.transactions.push({
			id: "01900000-0000-7000-8000-000000000010",
			name: "Bank settled charge",
			amount: 18.5,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: model.startDate,
			endDate: null,
			annualIncrease: 0,
			enabled: true,
			readOnly: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			pending: false,
			void: false,
			syncOwned: true,
		});
		model.transactions.push({
			id: "01900000-0000-7000-8000-000000000011",
			name: "Owner disabled",
			amount: 5,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: model.startDate,
			endDate: null,
			annualIncrease: 0,
			enabled: false,
			readOnly: false,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			pending: false,
			void: false,
		});
		return model;
	}

	it("participates a settled bank row and excludes only owner-disabled rows", () => {
		const model = recordedModel();
		const rows = accountTransactions({
			accountId: "checking",
			accounts: model.accounts,
			transactions: model.transactions,
			startDate: model.startDate,
			projection: activityProjection(model),
		});
		expect(
			rows.find(
				(row) => row.transactionId === "01900000-0000-7000-8000-000000000010",
			),
		).toMatchObject({ excluded: false, pending: false, void: false });
		expect(
			rows.find(
				(row) => row.transactionId === "01900000-0000-7000-8000-000000000011",
			)?.excluded,
		).toBe(true);
	});

	it("excludes an owner-disabled settled bank row like any disabled actual", () => {
		const model = recordedModel();
		model.transactions.push({
			id: "01900000-0000-7000-8000-000000000012",
			name: "Disabled settled bank row",
			amount: 7.5,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: model.startDate,
			endDate: null,
			annualIncrease: 0,
			enabled: false,
			readOnly: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			pending: false,
			void: false,
			syncOwned: true,
		});
		const rows = accountTransactions({
			accountId: "checking",
			accounts: model.accounts,
			transactions: model.transactions,
			startDate: model.startDate,
			projection: activityProjection(model),
		});
		expect(
			rows.find(
				(row) => row.transactionId === "01900000-0000-7000-8000-000000000012",
			)?.excluded,
		).toBe(true);
	});
});

describe("void posted-version candidates", () => {
	function bankRow(overrides: Partial<Transaction>): Transaction {
		return {
			id: "01900000-0000-7000-8000-000000000020",
			name: "Bistro",
			amount: 50,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: "2026-10-20",
			endDate: null,
			annualIncrease: 0,
			enabled: false,
			readOnly: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			pending: false,
			void: true,
			syncOwned: true,
			...overrides,
		} as Transaction;
	}

	function settledRow(overrides: Partial<Transaction>): Transaction {
		return bankRow({
			id: "01900000-0000-7000-8000-000000000021",
			name: "Bistro",
			amount: 58,
			enabled: true,
			readOnly: false,
			pending: false,
			void: false,
			startDate: "2026-10-21",
			...overrides,
		});
	}

	const voidHold = bankRow({});

	it("flags a unique tip-bounded posted total", () => {
		expect(
			voidSettleCandidates({
				voidRow: voidHold,
				transactions: [settledRow({})],
			}).map((row) => row.id),
		).toEqual(["01900000-0000-7000-8000-000000000021"]);
	});

	it("lists ambiguous matches for the reviewer instead of holding out", () => {
		const candidates = voidSettleCandidates({
			voidRow: voidHold,
			transactions: [
				settledRow({ id: "a", amount: 55, startDate: "2026-10-21" }),
				settledRow({ id: "b", amount: 56, startDate: "2026-10-22" }),
			],
		});
		expect(candidates.map((row) => row.id).sort()).toEqual(["a", "b"]);
	});

	it("excludes beyond-tolerance, direction, account, and lifecycle mismatches", () => {
		const smallVoid = bankRow({ amount: 42.1 });
		const rows = [
			settledRow({ id: "far", amount: 80 }),
			settledRow({ id: "inflow", amount: 42.1, fromId: null, toId: "checking" }),
			settledRow({ id: "other", toId: "savings", fromId: null }),
			settledRow({ id: "pending", pending: true, enabled: false }),
			settledRow({ id: "voided", void: true, enabled: false }),
			settledRow({ id: "manual", syncOwned: false, readOnly: false }),
			settledRow({ id: "late", startDate: "2026-11-20" }),
			settledRow({ id: "zero", amount: 0, amountKnown: false }),
		];
		expect(
			voidSettleCandidates({ voidRow: smallVoid, transactions: rows }),
		).toEqual([]);
	});
});
