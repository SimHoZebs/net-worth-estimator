import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Transaction, Plan } from "../../../domain/model.ts";
import { testAccount } from "../../../mocks/account.ts";
import { projectionFixture } from "../../../mocks/projection.ts";
import { useCardCycleActivity } from "./useCardCycleActivity.ts";

afterEach(cleanup);

const card = {
	...testAccount.accounts[5]!,
	id: "household_card",
	name: "Household card",
};
const otherCard = { ...card, id: "other_card", name: "Other card" };

function purchase(
	id: string,
	date: string,
	amount: number,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...testAccount.transactions[0]!,
		id,
		name: id,
		startDate: date,
		amount,
		frequency: "once",
		fromId: card.id,
		toId: null,
		...overrides,
	};
}

const plan: Plan = {
	...testAccount,
	startDate: "2026-10-21",
	accounts: [...testAccount.accounts, card, otherCard],
	transactions: [
		purchase("before-closed", "2026-09-19", 999),
		purchase("closed-start", "2026-09-20", 100),
		purchase("closed-end", "2026-10-19", 200),
		purchase("new-start", "2026-10-20", 50),
		purchase("today", "2026-10-21", 25),
		purchase("future", "2026-10-22", 999),
		purchase("disabled", "2026-10-19", 999, { enabled: false }),
		purchase("payment", "2026-10-19", 999, {
			fromId: "checking",
			toId: card.id,
		}),
		purchase("other-card", "2026-10-19", 70, { fromId: otherCard.id }),
	],
};

const input = {
	plan,
	checkpoints: [
		{ AccountId: card.id, Date: "2026-10-19", Balance: -500 },
		{ AccountId: otherCard.id, Date: "2026-10-19", Balance: -700 },
		{ AccountId: card.id, Date: "2026-10-21", Balance: -900 },
	],
	projection: projectionFixture(),
	cards: [card, otherCard],
	trackedIds: [card.id],
	statementDay: 20,
	displayToday: "2026-10-21",
	transactionOrder: "oldest" as const,
};

describe("useCardCycleActivity", () => {
	it("uses closing balances despite incomplete purchases and keeps the new-cycle ledger separate", () => {
		const { result } = renderHook(() => useCardCycleActivity(input));
		expect(result.current.closedCycle).toMatchObject({
			start: "2026-09-20",
			end: "2026-10-19",
			total: 500,
		});
		expect(result.current.perAccount[0]!.derived).toBe(75);
		expect(
			result.current.chargeCycles.cycle.transactions.map(
				(row) => row.transactionId,
			),
		).toEqual(["new-start", "today"]);
		expect(
			result.current.chargeCycles["last-cycle"].transactions.map(
				(row) => row.transactionId,
			),
		).toEqual(["closed-start", "closed-end"]);
		expect(result.current.closedCycle.total).toBe(500);
	});

	it("includes every selected card and keeps sorting independent of totals", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				trackedIds: [card.id, otherCard.id],
				transactionOrder: "newest",
			}),
		);
		expect(result.current.closedCycle.total).toBe(1200);
		expect(
			result.current.chargeCycles.cycle.transactions.map(
				(row) => row.transactionId,
			),
		).toEqual(["today", "new-start"]);
		expect(
			result.current.chargeCycles["last-cycle"].transactions.map(
				(row) => row.transactionId,
			),
		).toEqual(["closed-end", "other-card", "closed-start"]);
	});

	it("includes pending charges before and after the checkpoint without changing saved balances or projections", () => {
		const pending = [
			purchase("pending-closed", "2026-10-19", 10, {
				enabled: false,
				pending: true,
			}),
			purchase("pending-before", "2026-10-20", 40, {
				enabled: false,
				pending: true,
			}),
			purchase("pending-checkpoint", "2026-10-21", 15, {
				enabled: false,
				pending: true,
			}),
			purchase("pending-after", "2026-10-22", 20, {
				enabled: false,
				pending: true,
			}),
			purchase("pending-future", "2026-10-23", 999, {
				enabled: false,
				pending: true,
			}),
			purchase("pending-other-card", "2026-10-22", 999, {
				enabled: false,
				pending: true,
				fromId: otherCard.id,
			}),
		];
		const projectionBefore = structuredClone(input.projection);
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				plan: { ...plan, transactions: [...plan.transactions, ...pending] },
				displayToday: "2026-10-22",
			}),
		);
		expect(result.current.perAccount[0]!.derived).toBe(150);
		const currentPending =
			result.current.chargeCycles.cycle.transactions.filter(
				(row) => row.pending,
			);
		expect(currentPending.map((row) => row.transactionId)).toEqual([
			"pending-before",
			"pending-checkpoint",
			"pending-after",
		]);
		expect(currentPending.every((row) => row.excluded)).toBe(true);
		expect(
			result.current.chargeCycles["last-cycle"].transactions.map(
				(row) => row.transactionId,
			),
		).toEqual(["closed-start", "closed-end", "pending-closed"]);
		expect(result.current.closedCycle.total).toBe(500);
		expect(pending.every((transaction) => !transaction.enabled)).toBe(true);
		expect(input.projection).toEqual(projectionBefore);
	});

	it("resolves a closed cycle across a year boundary and a custom statement day", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				displayToday: "2027-01-05",
				statementDay: 5,
			}),
		);
		expect(result.current.closedCycle).toMatchObject({
			start: "2026-12-05",
			end: "2027-01-04",
			total: 900,
		});
		expect(result.current.cycle.cycleStart).toBe("2027-01-05");
	});

	it("keeps cycle dates available while the projection is pending", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({ ...input, projection: null }),
		);
		expect(result.current.closedCycle.total).toBe(500);
		expect(result.current.cycle.cycleEnd).toBe("2026-11-19");
		expect(result.current.chargeCycles.cycle.transactions).toEqual([]);
		expect(result.current.chargeCycles["last-cycle"].transactions).toEqual([]);
	});
});
