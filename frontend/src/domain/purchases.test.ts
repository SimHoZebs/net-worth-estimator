import { describe, expect, it } from "vitest";
import {
	backendToDisplayPlan,
	displayPlanToBackendDocument,
} from "../api/adapter.ts";
import { accountTransactions } from "./accountActivity.ts";
import {
	isHistoricalTransaction,
	validatePlan,
	type PlannedPurchase,
} from "./model.ts";
import { movePurchase, purchaseQueue } from "./purchases.ts";
import { testAccount } from "../mocks/account.ts";
import { projectionFixture } from "../mocks/projection.ts";

function wish(id: string): PlannedPurchase {
	return {
		id,
		name: id,
		amount: 500,
		fromId: "checking",
		startDate: testAccount.startDate,
		enabled: true,
		readOnly: false,
	};
}

describe("purchase queue", () => {
	it("changes priorities without changing established payments or the input", () => {
		const plan = {
			...testAccount,
			plannedPurchases: [wish("laptop"), wish("chair")],
		};
		const next = movePurchase(plan, "chair", -1);
		expect(purchaseQueue(next.plannedPurchases).map((item) => item.id)).toEqual(
			["chair", "laptop"],
		);
		expect(purchaseQueue(plan.plannedPurchases).map((item) => item.id)).toEqual(
			["laptop", "chair"],
		);
		expect(next.transactions[0]).toBe(plan.transactions[0]);
		expect(movePurchase(next, "chair", -1)).toBe(next);
		expect(movePurchase(next, "missing", 1)).toBe(next);
	});

	it("round-trips wishlist rows through saved and exported accounts", () => {
		const plan = {
			...testAccount,
			plannedPurchases: [{ ...wish("laptop"), amount: 1500 }],
		};
		const converted = displayPlanToBackendDocument(plan, {
			presentation: {
				name: plan.name,
				origin: plan.origin,
				updatedAt: plan.updatedAt,
				revision: plan.revision,
				assumptions: plan.assumptions,
				accounts: {},
				transactions: {},
				plannedPurchases: {},
			},
		});
		expect(converted.report.losses).toEqual([]);
		expect(
			converted.document.postings.find((item) => item.id === "laptop")
				?.purchase,
		).toEqual({ priority: 0 });
		const loaded = backendToDisplayPlan({
			document: converted.document,
			status: { readOnly: false },
		});
		converted.document.evaluations.plannedPurchases = [
			{
				instanceId: "saved-purchases",
				name: "Purchases",
				enabled: true,
				config: {},
			},
		];
		const purchase = loaded.plan.plannedPurchases.find(
			(item) => item.id === "laptop",
		)!;
		expect(purchase.amount).toBe(1500);
		expect(
			isHistoricalTransaction(loaded.plan.transactions[0]!, "2030-01-01"),
		).toBe(false);
		const roundTrip = displayPlanToBackendDocument(loaded.plan, {
			sourceDocument: converted.document,
			presentation: loaded.presentation,
		});
		expect(roundTrip.document.evaluations.plannedPurchases).toEqual(
			converted.document.evaluations.plannedPurchases,
		);
		expect(
			roundTrip.document.postings.find((item) => item.id === "laptop"),
		).toEqual(converted.document.postings.find((item) => item.id === "laptop"));
	});

	it("never manufactures historical purchase activity", () => {
		const plan = {
			...testAccount,
			transactions: [],
			plannedPurchases: [wish("laptop")],
		};
		const activity = accountTransactions({
			accountId: "checking",
			plan,
			projection: projectionFixture(),
		});
		expect(activity).toEqual([]);
	});

	it("rejects wishes without funding accounts", () => {
		expect(
			validatePlan({
				...testAccount,
				plannedPurchases: [{ ...wish("laptop"), fromId: null }],
			}),
		).toBeInstanceOf(Error);
	});

	it("migrates legacy purchase transactions into the wishlist slice", () => {
		// Intentionally the pre-rename shape: old drafts stored wishlist
		// items in `transactions` with a purchasePriority field.
		const legacy = {
			...testAccount,
			transactions: [
				...testAccount.transactions,
				{
					...testAccount.transactions[0]!,
					id: "laptop",
					name: "laptop",
					amount: 500,
					fromId: "checking",
					toId: null,
					frequency: "once" as const,
					purchasePriority: 0,
				},
			],
		};
		const parsed = validatePlan(legacy);
		expect(parsed).not.toBeInstanceOf(Error);
		if (parsed instanceof Error) throw parsed;
		expect(parsed.plannedPurchases.map((item) => item.id)).toEqual(["laptop"]);
		expect(parsed.transactions.some((item) => item.id === "laptop")).toBe(
			false,
		);
	});
});
