import { describe, expect, it } from "vitest";
import type { TransferLink } from "@/api/generated/model/transferLink.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";
import { buildSafeSpendingActivity } from "./safeSpendingActivity.ts";

const checking = financialModelFixture.accounts[0]!;
const savings = financialModelFixture.accounts[1]!;
const card: Account = {
	...financialModelFixture.accounts[5]!,
	id: "card",
	name: "Test card",
	kind: "credit_card",
	maxBalance: null,
};
const otherCard: Account = { ...card, id: "other-card", name: "Other card" };
const accounts = [checking, savings, card, otherCard];

function transaction(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		kind: "transaction",
		amount: 10,
		amountKnown: true,
		fromId: card.id,
		toId: null,
		startDate: "2026-11-10",
		endDate: null,
		enabled: true,
		readOnly: false,
		void: false,
		pending: false,
		transactionTime: null,
		...overrides,
	};
}

function link(legA: string, legB: string): TransferLink {
	return {
		legA,
		legB,
		actor: "owner",
		createdAt: 1,
		findingId: `finding-${legA}-${legB}`,
	};
}

function activity(
	transactions: Transaction[],
	overrides: Partial<Parameters<typeof buildSafeSpendingActivity>[0]> = {},
) {
	return buildSafeSpendingActivity({
		accounts,
		transactions,
		trackedIds: [card.id],
		spendingIds: [checking.id],
		summary: summaryFixture({
			cycleStart: "2026-11-01",
			cycleEnd: "2026-11-30",
			paymentPeriodStart: "2026-10-01",
			payoffDate: "2026-12-31",
			cashAsOf: "2026-11-30",
		}),
		...overrides,
	});
}

const ids = (rows: { transactionId: string }[]) =>
	rows.map((row) => row.transactionId);

describe("safe spending recorded activity", () => {
	it("uses selected cards and cash accounts with inclusive window and as-of bounds", () => {
		const result = activity([
			transaction("before", { startDate: "2026-10-31" }),
			transaction("start", { startDate: "2026-11-01" }),
			transaction("end", { startDate: "2026-11-30" }),
			transaction("after", { startDate: "2026-12-01" }),
			transaction("cash", {
				fromId: checking.id,
				startDate: "2026-11-15",
			}),
			transaction("unselected-cash", {
				fromId: savings.id,
				startDate: "2026-11-15",
			}),
			transaction("unselected-card", {
				fromId: otherCard.id,
				startDate: "2026-11-15",
			}),
		]);
		expect(ids(result.spending)).toEqual(["end", "cash", "start"]);
		expect(result.count).toBe(3);
		expect(result.summary.total).toBe(30);

		const earlierCut = activity(
			[
				transaction("at-cut", { startDate: "2026-11-15" }),
				transaction("after-cut", { startDate: "2026-11-16" }),
			],
			{
				summary: summaryFixture({
					cycleStart: "2026-11-01",
					cycleEnd: "2026-11-30",
					cashAsOf: "2026-11-15",
				}),
			},
		);
		expect(ids(earlierCut.spending)).toEqual(["at-cut"]);
	});

	it("includes later same-day posted and pending rows but excludes next-day instants", () => {
		const result = activity(
			[
				transaction("posted-late", {
					startDate: "2026-11-15",
					transactionTime: Date.parse("2026-11-15T23:59:00Z") / 1000,
				}),
				transaction("pending-late", {
					startDate: "2026-11-15",
					transactionTime: Date.parse("2026-11-15T23:58:00Z") / 1000,
					enabled: false,
					pending: true,
					syncOwned: true,
				}),
				transaction("next-day-posted", {
					startDate: "2026-11-15",
					transactionTime: Date.parse("2026-11-16T00:00:00Z") / 1000,
				}),
				transaction("next-day-pending", {
					startDate: "2026-11-15",
					transactionTime: Date.parse("2026-11-16T00:01:00Z") / 1000,
					enabled: false,
					pending: true,
					syncOwned: true,
				}),
				transaction("untimed", { startDate: "2026-11-15" }),
			],
			{
				summary: summaryFixture({
					cycleStart: "2026-11-01",
					cycleEnd: "2026-11-30",
					cashAsOf: "2026-11-15",
				}),
			},
		);
		expect(ids(result.spending)).toEqual([
			"posted-late",
			"pending-late",
			"untimed",
		]);
	});

	it("uses the transactionTime UTC day for the active-cycle start", () => {
		const result = activity([
			transaction("instant-before-cycle", {
				startDate: "2026-11-01",
				transactionTime: Date.parse("2026-10-31T23:59:00Z") / 1000,
			}),
			transaction("instant-at-cycle", {
				startDate: "2026-11-01",
				transactionTime: Date.parse("2026-11-01T00:00:00Z") / 1000,
			}),
		]);
		expect(ids(result.spending)).toEqual(["instant-at-cycle"]);
	});

	it("uses the active cycle instead of the payment window and caps at cashAsOf", () => {
		const summary = summaryFixture({
			cycleStart: "2026-11-01",
			cycleEnd: "2026-11-19",
			paymentPeriodStart: "2026-10-31",
			payoffDate: "2026-11-30",
			cashAsOf: "2026-11-30",
		});
		const result = activity(
			[
				transaction("before-cycle", { startDate: "2026-10-31" }),
				transaction("cycle-start-payment", {
					fromId: checking.id,
					toId: card.id,
					startDate: "2026-11-01",
				}),
				transaction("cycle-end", { startDate: "2026-11-19" }),
				transaction("next-cycle-in-payment-window", {
					startDate: "2026-11-20",
				}),
			],
			{ summary },
		);
		expect(ids(result.spending)).toEqual(["cycle-end"]);
		expect(ids(result.cashPayments)).toEqual(["cycle-start-payment"]);
		expect(result.count).toBe(2);

		const earlierCut = activity(
			[
				transaction("at-cut", { startDate: "2026-11-15" }),
				transaction("after-cut", { startDate: "2026-11-16" }),
			],
			{ summary: { ...summary, cashAsOf: "2026-11-15" } },
		);
		expect(ids(earlierCut.spending)).toEqual(["at-cut"]);
	});

	it("includes pending rows and omits void, disabled, excluded, and scheduled rows", () => {
		const result = activity([
			transaction("pending", {
				enabled: false,
				pending: true,
				syncOwned: true,
			}),
			transaction("void", { void: true, enabled: false, syncOwned: true }),
			transaction("disabled", { enabled: false }),
			transaction("excluded", { enabled: false, syncOwned: false }),
			transaction("schedule", { kind: "schedule" }),
			transaction("pending-after-cut", {
				enabled: false,
				pending: true,
				syncOwned: true,
				startDate: "2026-12-01",
			}),
		]);
		expect(ids(result.spending)).toEqual(["pending"]);
		expect(result.spending[0]).toMatchObject({
			pending: true,
			excluded: false,
		});
	});

	it("omits income and retains categorized refunds as spending credits", () => {
		const result = activity([
			transaction("salary", {
				fromId: null,
				toId: checking.id,
				category: "INCOME",
			}),
			transaction("uncategorized-incoming", {
				fromId: null,
				toId: checking.id,
			}),
			transaction("refund", {
				fromId: null,
				toId: card.id,
				amount: 20,
				category: "FOOD_AND_DRINK",
			}),
			transaction("purchase", { amount: 50 }),
		]);
		expect(ids(result.spending)).toEqual(["purchase", "refund"]);
		expect(
			result.spending.find((row) => row.transactionId === "refund"),
		).toMatchObject({
			direction: "in",
			spendingAmount: -20,
		});
		expect(result.summary.total).toBe(30);
	});

	it("classifies transfers only through explicit routes or confirmed links", () => {
		const result = activity(
			[
				transaction("explicit-payment", {
					fromId: checking.id,
					toId: card.id,
					amount: 80,
				}),
				transaction("linked-payment", {
					fromId: checking.id,
					amount: 100,
				}),
				transaction("linked-card-leg", {
					fromId: null,
					toId: card.id,
					amount: 100,
				}),
				transaction("Payment to card", {
					fromId: checking.id,
					amount: 25,
				}),
			],
			{ transferLinks: [link("linked-payment", "linked-card-leg")] },
		);
		expect(ids(result.spending)).toEqual(["Payment to card"]);
		expect(ids(result.cashPayments)).toEqual([
			"explicit-payment",
			"linked-payment",
		]);
		expect(result.cashPayments.every((row) => row.flow === "transfer")).toBe(
			true,
		);
		expect(result.cashPaymentsTotal).toBe(180);
	});

	it("deduplicates overlapping selections and both legs of a confirmed transfer", () => {
		const result = activity(
			[
				transaction("shared-purchase", { fromId: checking.id, amount: 40 }),
				transaction("payment", { fromId: checking.id, amount: 90 }),
				transaction("card-leg", {
					fromId: null,
					toId: card.id,
					amount: 90,
				}),
			],
			{
				trackedIds: [checking.id, checking.id],
				spendingIds: [checking.id, checking.id],
				transferLinks: [link("payment", "card-leg")],
			},
		);
		expect(ids(result.spending)).toEqual(["shared-purchase"]);
		expect(ids(result.cashPayments)).toEqual(["payment"]);
		expect(result.summary.total).toBe(40);
		expect(result.cashPaymentsTotal).toBe(90);
		expect(result.count).toBe(2);
	});

	it("keeps unknown calculated amounts unknown in every affected aggregate", () => {
		const result = activity([
			transaction("known-card", { amount: 10 }),
			transaction("unknown-cash", {
				fromId: checking.id,
				amount: 0,
				amountKnown: false,
			}),
			transaction("unknown-payment", {
				fromId: checking.id,
				toId: card.id,
				amount: 0,
				amountKnown: false,
			}),
		]);
		expect(result.summary.total).toBeNull();
		expect(result.summary.byCard).toEqual([
			{ id: card.id, name: "Test card", amount: 10 },
		]);
		expect(result.cashPaymentsTotal).toBeNull();

		const unknownCard = activity([
			transaction("calculated-card", { amount: 0, amountKnown: false }),
		]);
		expect(unknownCard.summary.total).toBeNull();
		expect(unknownCard.summary.byCard[0]?.amount).toBeNull();
	});

	it("uses transactionTime for exact same-day chronology and stable ties", () => {
		const rows = [
			transaction("noon", {
				transactionTime: Date.parse("2026-11-10T12:00:00Z") / 1000,
			}),
			transaction("morning", {
				transactionTime: Date.parse("2026-11-10T09:00:00Z") / 1000,
			}),
			transaction("evening", {
				transactionTime: Date.parse("2026-11-10T15:00:00Z") / 1000,
			}),
			transaction("untimed", { transactionTime: null }),
			transaction("tie-b", {
				transactionTime: Date.parse("2026-11-10T12:00:00Z") / 1000,
			}),
			transaction("tie-a", {
				transactionTime: Date.parse("2026-11-10T12:00:00Z") / 1000,
			}),
		];
		expect(ids(activity(rows).spending)).toEqual([
			"evening",
			"noon",
			"tie-a",
			"tie-b",
			"morning",
			"untimed",
		]);
		expect(ids(activity(rows, { order: "oldest" }).spending)).toEqual([
			"untimed",
			"morning",
			"noon",
			"tie-a",
			"tie-b",
			"evening",
		]);
	});
});
