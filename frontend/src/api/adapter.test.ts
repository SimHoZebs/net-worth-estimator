import { describe, expect, it } from "vitest";
import {
	isHistoricalTransaction,
	visibleAccounts,
	visiblePlannedPurchases,
	visibleTransactions,
	type Account,
	type PlannedPurchase,
	type Transaction,
} from "../domain/model.ts";
import {
	balanceRowToDisplay,
	plannedPurchaseRowToDisplay,
	savedPurchasesToDisplay,
} from "./adapter.ts";
import type { AccountBalanceRow } from "./generated/model/accountBalanceRow.ts";
import {
	type BackendPlannedPurchase,
	type BackendPosting,
	type FinancialModelDocument,
	NO_CEILING_SENTINEL,
	NO_FLOOR_SENTINEL,
} from "./contracts.ts";

function balanceRow(
	overrides: Partial<AccountBalanceRow> = {},
): AccountBalanceRow {
	return {
		archived: false,
		balance: 100,
		enabled: true,
		hasCheckpoint: true,
		id: "cash",
		kind: "cash",
		maxBalance: null,
		minBalance: null,
		name: "Cash",
		observedOn: "2026-01-31",
		readOnly: false,
		syncOwned: false,
		...overrides,
	};
}

function purchaseRow(
	overrides: Partial<BackendPlannedPurchase> = {},
): BackendPlannedPurchase {
	return {
		id: "laptop",
		name: "Laptop",
		fundingAccountId: "cash",
		cost: 500,
		earliestDate: "2026-03-01",
		enabled: true,
		priority: 0,
		...overrides,
	};
}

describe("balance rows to display accounts", () => {
	it("maps checkpoint presence to balance verification and source labels", () => {
		expect(balanceRowToDisplay(balanceRow())).toMatchObject({
			id: "cash",
			balance: 100,
			observedOn: "2026-01-31",
			balanceCheck: true,
			source: "Backend checkpoint",
			readOnly: false,
		});
		expect(
			balanceRowToDisplay(balanceRow({ hasCheckpoint: false })),
		).toMatchObject({
			balanceCheck: false,
			source: "Backend account",
		});
		expect(
			balanceRowToDisplay(balanceRow({ syncOwned: true, readOnly: true })),
		).toMatchObject({
			source: "Synced checkpoint",
			readOnly: true,
		});
	});

	it("defaults null bounds to zero floor and unbounded ceiling", () => {
		expect(balanceRowToDisplay(balanceRow())).toMatchObject({
			minBalance: 0,
			maxBalance: null,
		});
		expect(
			balanceRowToDisplay(balanceRow({ minBalance: 250, maxBalance: 1000 })),
		).toMatchObject({ minBalance: 250, maxBalance: 1000 });
	});

	it("clamps negative backend bounds to the display range", () => {
		expect(
			balanceRowToDisplay(balanceRow({ minBalance: -50, maxBalance: -10 })),
		).toMatchObject({ minBalance: 0, maxBalance: null });
	});

	it("maps backend no-bound sentinels to absent before clamping", () => {
		expect(
			balanceRowToDisplay(
				balanceRow({
					minBalance: NO_FLOOR_SENTINEL,
					maxBalance: NO_CEILING_SENTINEL,
				}),
			),
		).toMatchObject({ minBalance: 0, maxBalance: null });
	});

	it("carries colors and falls back to the row id for a blank name", () => {
		expect(balanceRowToDisplay(balanceRow({ color: "#4287f5" })).color).toBe(
			"#4287f5",
		);
		expect(
			balanceRowToDisplay(balanceRow({ color: undefined })).color,
		).toBeNull();
		expect(balanceRowToDisplay(balanceRow({ name: "" })).name).toBe("cash");
	});

	it("keeps the server archived state for display filtering", () => {
		const accounts = [
			balanceRowToDisplay(balanceRow()),
			balanceRowToDisplay(
				balanceRow({ id: "loan", kind: "debt", archived: true, balance: 0 }),
			),
		];
		expect(visibleAccounts(accounts).map((account) => account.id)).toEqual([
			"cash",
		]);
	});
});

describe("planned purchase rows to display purchases", () => {
	it("maps cost, funding account, and earliest date", () => {
		expect(plannedPurchaseRowToDisplay(purchaseRow())).toEqual({
			id: "laptop",
			name: "Laptop",
			amount: 500,
			fromId: "cash",
			startDate: "2026-03-01",
			enabled: true,
			readOnly: false,
		});
	});

	it("clamps negative costs and falls back to the row id", () => {
		expect(
			plannedPurchaseRowToDisplay(purchaseRow({ cost: -20, name: "" })),
		).toMatchObject({ amount: 0, name: "laptop" });
	});
});

function purchasePosting(
	overrides: Partial<BackendPosting> = {},
): BackendPosting {
	return {
		id: "laptop",
		name: "Laptop",
		sourceAccountId: "cash",
		destinations: null,
		amount: {
			resolver: "expression",
			config: { expression: "500" },
			inputs: {},
		},
		postedTime: 1769904000,
		transactionTime: 1769904000,
		purchase: { priority: 0 },
		enabled: true,
		...overrides,
	};
}

function purchaseDocument(
	postings: BackendPosting[] = [],
	plannedPurchases: BackendPlannedPurchase[] = [],
): FinancialModelDocument {
	return {
		sourcePath: "models/household.json",
		accounts: [],
		checkpoints: [],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
			cycleFulfillment: [],
		},
		postings,
		recurrenceRules: [],
		plannedPurchases,
	};
}

describe("saved purchases from standalone and legacy posting rows", () => {
	it("reads legacy purchase-marker postings with literal cost and priority", () => {
		expect(
			savedPurchasesToDisplay(
				purchaseDocument([purchasePosting({ purchase: { priority: 2 } })]),
			),
		).toEqual([
			{
				id: "laptop",
				name: "Laptop",
				amount: 500,
				fromId: "cash",
				startDate: "2026-02-01",
				enabled: true,
				readOnly: false,
			},
		]);
	});

	it("orders by priority and ignores postings without a purchase marker", () => {
		const rows = savedPurchasesToDisplay(
			purchaseDocument([
				purchasePosting({
					id: "second",
					name: "Second",
					purchase: { priority: 1 },
				}),
				purchasePosting({ id: "plain", name: "Plain", purchase: null }),
				purchasePosting({
					id: "first",
					name: "First",
					amount: {
						resolver: "expression",
						config: { expression: "25" },
						inputs: {},
					},
					purchase: { priority: 0 },
				}),
			]),
		);
		expect(rows.map((row) => row.id)).toEqual(["first", "second"]);
		expect(rows[0]).toMatchObject({ amount: 25, fromId: "cash" });
	});

	it("dedupes a row present in both forms, preferring the standalone row", () => {
		const rows = savedPurchasesToDisplay(
			purchaseDocument(
				[
					purchasePosting({
						amount: {
							resolver: "expression",
							config: { expression: "999" },
							inputs: {},
						},
						purchase: { priority: 5 },
					}),
				],
				[purchaseRow({ priority: 0 })],
			),
		);
		expect(rows).toEqual([
			{
				id: "laptop",
				name: "Laptop",
				amount: 500,
				fromId: "cash",
				startDate: "2026-03-01",
				enabled: true,
				readOnly: false,
			},
		]);
	});

	it("derives the earliest date from the transaction stamp", () => {
		const rows = savedPurchasesToDisplay(
			purchaseDocument([
				purchasePosting({ transactionTime: 1770076800, postedTime: 0 }),
			]),
		);
		expect(rows[0]).toMatchObject({ startDate: "2026-02-03" });
	});

	it("clamps non-literal costs instead of dropping the row", () => {
		const rows = savedPurchasesToDisplay(
			purchaseDocument([
				purchasePosting({
					amount: { resolver: "recipe", config: {}, inputs: {} },
				}),
			]),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ amount: 0 });
	});

	it("returns an empty queue for a missing document", () => {
		expect(savedPurchasesToDisplay(null)).toEqual([]);
		expect(savedPurchasesToDisplay(undefined)).toEqual([]);
	});
});

describe("display visibility helpers over saved rows", () => {
	const accounts: Account[] = [
		{
			id: "cash",
			name: "Cash",
			kind: "cash",
			enabled: true,
			archived: false,
			balance: 100,
			minBalance: 0,
			maxBalance: null,
			color: null,
			observedOn: "2026-01-31",
			balanceCheck: true,
			source: "Backend checkpoint",
			readOnly: false,
		},
		{
			id: "loan",
			name: "Loan",
			kind: "debt",
			enabled: true,
			archived: true,
			balance: 0,
			minBalance: 0,
			maxBalance: null,
			color: null,
			observedOn: "2026-01-31",
			balanceCheck: true,
			source: "Backend checkpoint",
			readOnly: false,
		},
	];
	const transactions: Transaction[] = [
		{
			id: "salary",
			name: "Salary",
			amount: 250,
			amountKnown: true,
			fromId: null,
			toId: "cash",
			frequency: "monthly",
			startDate: "2026-02-05",
			endDate: null,
			annualIncrease: 2,
			enabled: true,
			readOnly: false,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			void: false,
		},
		{
			id: "repayment",
			name: "Repayment",
			amount: 50,
			amountKnown: true,
			fromId: "cash",
			toId: "loan",
			frequency: "monthly",
			startDate: "2026-02-05",
			endDate: null,
			annualIncrease: 0,
			enabled: true,
			readOnly: false,
			claimRuleId: null,
			claimOccurrenceDate: null,
			postedDate: null,
			void: false,
		},
	];
	const plannedPurchases: PlannedPurchase[] = [
		{
			id: "laptop",
			name: "Laptop",
			amount: 500,
			fromId: "cash",
			startDate: "2026-03-01",
			enabled: true,
			readOnly: false,
		},
		{
			id: "payoff",
			name: "Payoff",
			amount: 10,
			fromId: "loan",
			startDate: "2026-03-01",
			enabled: true,
			readOnly: false,
		},
	];

	it("hides archived accounts and their transactions and purchases", () => {
		expect(visibleAccounts(accounts).map((account) => account.id)).toEqual([
			"cash",
		]);
		expect(
			visibleTransactions({ transactions, accounts }).map(
				(transaction) => transaction.id,
			),
		).toEqual(["salary"]);
		expect(
			visiblePlannedPurchases({ plannedPurchases, accounts }).map(
				(purchase) => purchase.id,
			),
		).toEqual(["laptop"]);
	});

	it("classifies one-time transactions at or before the start as historical", () => {
		const startDate = "2026-02-01";
		expect(
			isHistoricalTransaction(
				{
					...transactions[0]!,
					frequency: "once",
					startDate: "2026-02-01",
				},
				startDate,
			),
		).toBe(true);
		expect(isHistoricalTransaction(transactions[0]!, startDate)).toBe(false);
		expect(
			isHistoricalTransaction(
				{ ...transactions[0]!, frequency: "once", startDate: "2026-03-01" },
				startDate,
			),
		).toBe(false);
	});
});
