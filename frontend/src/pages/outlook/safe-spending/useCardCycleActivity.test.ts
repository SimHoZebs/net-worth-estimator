import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../domain/model.ts";
import { financialModelFixture } from "../../../mocks/financialModel.ts";
import {
	projectionFixture,
	transactionFixture,
} from "../../../mocks/projection.ts";
import { useCardCycleActivity } from "./useCardCycleActivity.ts";

const card = {
	...financialModelFixture.accounts[5]!,
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
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		startDate: date,
		amount,
		kind: "transaction",
		fromId: card.id,
		toId: null,
		...overrides,
	};
}

const sourceAccounts = [...financialModelFixture.accounts, card, otherCard];
const sourceTransactions = [
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
];

const input = {
	accounts: sourceAccounts,
	transactions: sourceTransactions,
	projection: projectionFixture(),
	cards: [card, otherCard],
	trackedIds: [card.id],
	statementDay: 20,
	displayToday: "2026-10-21",
	cycleOffset: 0,
};

function selectedIds(offset: number) {
	const { result } = renderHook(() =>
		useCardCycleActivity({ ...input, cycleOffset: offset }),
	);
	return result.current.perAccount.flatMap((item) =>
		item.selected.map((row) => row.transactionId),
	);
}

describe("useCardCycleActivity", () => {
	it("reads saved card purchases through today independently of an older checkpoint", () => {
		const saved = purchase("after-checkpoint", "2026-11-14", 100);
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: 0,
				displayToday: "2026-11-15",
				transactions: [
					saved,
					purchase("future", "2026-11-16", 999),
					purchase("disabled-after", "2026-11-14", 999, { enabled: false }),
				],
				projection: projectionFixture({
					transactions: [
						transactionFixture({
							transactionId: saved.id,
							date: "2026-11-14",
							fromId: card.id,
							toId: null,
							requested: 100,
							realized: 100,
						}),
						transactionFixture({
							transactionId: "projected-only-schedule",
							date: "2026-11-14",
							fromId: card.id,
							toId: null,
							requested: 999,
							realized: 999,
						}),
					],
				}),
			}),
		);
		expect(
			result.current.perAccount[0]!.selected.map((row) => [
				row.transactionId,
				row.source,
			]),
		).toEqual([[saved.id, "historical"]]);
	});
	it("resolves the selected window for the current, past, and future offsets", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({ ...input, cycleOffset: 0 }),
		);
		expect(result.current.selected).toMatchObject({
			cycleStart: "2026-10-20",
			cycleEnd: "2026-11-19",
		});
		expect(selectedIds(0).sort()).toEqual(["new-start", "today"]);
		const { result: previous } = renderHook(() =>
			useCardCycleActivity({ ...input, cycleOffset: -1 }),
		);
		expect(previous.current.selected).toMatchObject({
			cycleStart: "2026-09-20",
			cycleEnd: "2026-10-19",
		});
		expect(
			previous.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["closed-end", "closed-start"]);
		const { result: next } = renderHook(() =>
			useCardCycleActivity({ ...input, cycleOffset: 1 }),
		);
		expect(next.current.selected).toMatchObject({
			cycleStart: "2026-11-20",
			cycleEnd: "2026-12-19",
		});
		expect(
			next.current.perAccount.flatMap((item) => item.selected),
		).toEqual([]);
	});

	it("includes every selected card in the same selected window", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: 0,
				trackedIds: [card.id, otherCard.id],
			}),
		);
		expect(
			result.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["new-start", "today"]);
		const { result: previous } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: -1,
				trackedIds: [card.id, otherCard.id],
			}),
		);
		expect(
			previous.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["closed-end", "closed-start", "other-card"]);
	});

	it("includes pending charges in the selected window without changing projections", () => {
		const pendingRows = [
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
				cycleOffset: 0,
				transactions: [...sourceTransactions, ...pendingRows],
				displayToday: "2026-10-22",
			}),
		);
		// The saved Oct 22 purchase is now recorded too. Future Oct 23 holds
		// remain outside today.
		const currentPending = result.current.perAccount
			.flatMap((item) => item.selected)
			.filter((row) => row.pending);
		expect(currentPending.map((row) => row.transactionId).sort()).toEqual([
			"pending-after",
			"pending-before",
			"pending-checkpoint",
		]);
		expect(currentPending.every((row) => row.excluded)).toBe(true);
		const { result: previous } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: -1,
				transactions: [...sourceTransactions, ...pendingRows],
				displayToday: "2026-10-22",
			}),
		);
		expect(
			previous.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["closed-end", "closed-start", "pending-closed"]);
		expect(pendingRows.every((transaction) => !transaction.enabled)).toBe(true);
		expect(input.projection).toEqual(projectionBefore);
	});

	it("excludes void holds from the selected window", () => {
		const voidCurrent = purchase("void-current", "2026-10-20", 30, {
			enabled: false,
			pending: false,
			void: true,
			syncOwned: true,
			readOnly: true,
		});
		const voidClosed = purchase("void-closed", "2026-10-19", 40, {
			enabled: false,
			pending: false,
			void: true,
			syncOwned: true,
			readOnly: true,
		});
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: 0,
				transactions: [...sourceTransactions, voidCurrent, voidClosed],
			}),
		);
		expect(
			result.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["new-start", "today"]);
		const { result: previous } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: -1,
				transactions: [...sourceTransactions, voidCurrent, voidClosed],
			}),
		);
		expect(
			previous.current.perAccount
				.flatMap((item) => item.selected.map((row) => row.transactionId))
				.sort(),
		).toEqual(["closed-end", "closed-start"]);
	});

	it("resolves a selected cycle across a year boundary and a custom statement day", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: -1,
				displayToday: "2027-01-05",
				statementDay: 5,
			}),
		);
		expect(result.current.selected).toMatchObject({
			cycleStart: "2026-12-05",
			cycleEnd: "2027-01-04",
		});
		const { result: next } = renderHook(() =>
			useCardCycleActivity({
				...input,
				cycleOffset: 1,
				displayToday: "2026-12-20",
				statementDay: 20,
			}),
		);
		expect(next.current.selected).toMatchObject({
			cycleStart: "2027-01-20",
			cycleEnd: "2027-02-19",
		});
	});

	it("leaves a future selected cycle empty through today", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({ ...input, cycleOffset: 1 }),
		);
		expect(result.current.selected).toMatchObject({
			cycleStart: "2026-11-20",
			cycleEnd: "2026-12-19",
		});
		expect(result.current.perAccount.flatMap((item) => item.selected)).toEqual(
			[],
		);
	});

	it("keeps cycle dates available while the projection is pending", () => {
		const { result } = renderHook(() =>
			useCardCycleActivity({ ...input, cycleOffset: 0, projection: null }),
		);
		expect(result.current.selected.cycleEnd).toBe("2026-11-19");
		expect(result.current.perAccount).toEqual([]);
	});
});
