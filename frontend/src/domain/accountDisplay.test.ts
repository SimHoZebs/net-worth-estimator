import { describe, expect, it } from "vitest";
import type { Account } from "./model.ts";
import {
	componentIds,
	displayBalance,
	toDisplayAccounts,
	toDisplayTransaction,
} from "./accountDisplay.ts";
import { toAccountCards } from "./accountCards.ts";
import { accountTrendRows } from "./chart.ts";
import { projectionFixture, transactionFixture } from "../mocks/projection.ts";
import { accountTransactions } from "./accountActivity.ts";

function account(id: string, balance: number): Account {
	return {
		id,
		name: id,
		kind: "debt",
		enabled: true,
		archived: false,
		balance,
		minBalance: 0,
		maxBalance: 0,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		observedAt: 100,
		observedBalance: balance,
	};
}
function fixture() {
	const principal = account("p", -1000);
	principal.display = {
		name: "Student loan",
		components: [
			{ accountId: "p", role: "principal" },
			{ accountId: "i", role: "interest" },
		],
		interestScheduleId: "charge",
		paymentScheduleId: "pay",
	};
	return [principal, account("i", -20), account("unrelated-interest", -30)];
}

describe("visible accounts", () => {
	it("groups explicit roles once and preserves ordinary accounts", () => {
		const raw = fixture();
		const grouped = toDisplayAccounts(raw);
		expect(grouped).toHaveLength(2);
		expect(grouped[0]).toMatchObject({
			name: "Student loan",
			balance: -1020,
			observedBalance: -1020,
		});
		expect(grouped[1]).toBe(raw[2]);
		expect(raw[0]!.balance).toBe(-1000);
		expect(componentIds(grouped[0]!)).toEqual(["p", "i"]);
		expect(
			toAccountCards({ accounts: grouped, projection: null })[0]?.balance,
		).toBe(1020);
	});
	it("keeps different observation times separate", () => {
		const raw = fixture();
		raw[1]!.observedAt = 200;
		expect(toDisplayAccounts(raw)[0]).toMatchObject({
			observedBalance: null,
			observedAt: null,
			balanceCheck: false,
			balance: -1020,
		});
	});
	it("includes interest-only balances in projection lines", () => {
		const accounts = toDisplayAccounts(fixture());
		const balances = { p: 0, i: -15 };
		expect(displayBalance(accounts[0]!, balances)).toBe(-15);
		const projection = projectionFixture();
		const points = [{ ...projection.points[0]!, balances }];
		const result = accountTrendRows({ points, accounts });
		expect(result.series).toHaveLength(1);
		expect(result.rows[0]?.balance).toBe(-15);
	});
	it("shows one payment with both component deltas in account activity", () => {
		const accounts = toDisplayAccounts(fixture());
		const projection = projectionFixture();
		projection.transactions = [
			{
				...transactionFixture(),
				transactionId: "pay",
				date: "2026-02-02",
				fromId: "checking",
				toId: "i",
				requested: 100,
				realized: 100,
				accountDeltas: [
					{ accountId: "checking", delta: -100 },
					{ accountId: "i", delta: 20 },
					{ accountId: "p", delta: 80 },
				],
			},
		];
		const rows = accountTransactions({
			accountId: "p",
			accounts,
			transactions: [],
			projection,
			startDate: "2026-01-31",
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			amount: 100,
			direction: "in",
			to: "Student loan",
		});
	});
	it("maps an interest endpoint to the visible loan", () => {
		const accounts = toDisplayAccounts(fixture());
		const row = toDisplayTransaction(
			{
				id: "pay",
				fromId: "checking",
				toId: "i",
				readOnly: false,
			} as Parameters<typeof toDisplayTransaction>[0],
			accounts,
		);
		expect(row.toId).toBe("p");
		expect(row.readOnly).toBe(true);
	});
});
