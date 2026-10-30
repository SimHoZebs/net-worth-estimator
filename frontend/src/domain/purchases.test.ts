import { describe, expect, it } from "vitest";
import {
	plannedPurchaseSchema,
	transactionSchema,
	type PlannedPurchase,
} from "./model.ts";
import { movePurchase, purchaseQueue } from "./purchases.ts";

function wish(
	id: string,
	overrides: Partial<PlannedPurchase> = {},
): PlannedPurchase {
	return {
		id,
		name: id,
		amount: 500,
		fromId: "checking",
		startDate: "2026-09-24",
		enabled: true,
		readOnly: false,
		...overrides,
	};
}

describe("purchase queue", () => {
	it("keeps array order as the queue priority", () => {
		const purchases = [wish("laptop"), wish("chair")];
		expect(purchaseQueue(purchases).map((item) => item.id)).toEqual([
			"laptop",
			"chair",
		]);
		// A copy, so callers cannot reorder the saved rows by accident.
		expect(purchaseQueue(purchases)).not.toBe(purchases);
	});

	it("moves a row up and down the queue", () => {
		const purchases = [wish("laptop"), wish("chair"), wish("desk")];
		expect(movePurchase(purchases, "chair", -1).map((item) => item.id)).toEqual(
			["chair", "laptop", "desk"],
		);
		expect(movePurchase(purchases, "chair", 1).map((item) => item.id)).toEqual([
			"laptop",
			"desk",
			"chair",
		]);
		// The input is never mutated.
		expect(purchases.map((item) => item.id)).toEqual([
			"laptop",
			"chair",
			"desk",
		]);
	});

	it("leaves the queue unchanged for edge and unknown moves", () => {
		const purchases = [wish("laptop"), wish("chair")];
		expect(movePurchase(purchases, "laptop", -1)).toBe(purchases);
		expect(movePurchase(purchases, "chair", 1)).toBe(purchases);
		expect(movePurchase(purchases, "missing", 1)).toBe(purchases);
	});

	it("rejects invalid wishlist rows", () => {
		expect(
			plannedPurchaseSchema.safeParse(wish("laptop", { amount: 0 })).success,
		).toBe(false);
		expect(
			plannedPurchaseSchema.safeParse(wish("laptop", { amount: -5 })).success,
		).toBe(false);
		expect(
			plannedPurchaseSchema.safeParse(wish("laptop", { name: "  " })).success,
		).toBe(false);
		expect(
			plannedPurchaseSchema.safeParse(wish("laptop", { fromId: "" })).success,
		).toBe(false);
		expect(plannedPurchaseSchema.safeParse(wish("laptop")).success).toBe(true);
	});

	it("keeps a hypothetical wish distinct from a scheduled transaction", () => {
		const item = wish("laptop");
		// A wish is a placeholder for a future buy: it carries no schedule of
		// its own, so it never validates as a transaction record.
		expect(plannedPurchaseSchema.safeParse(item).success).toBe(true);
		expect(transactionSchema.safeParse(item).success).toBe(false);
		// Queue rows never grow transaction fields by moving.
		for (const row of movePurchase([item, wish("chair")], "chair", -1)) {
			expect(row).not.toHaveProperty("frequency");
			expect(row).not.toHaveProperty("toId");
		}
	});
});
