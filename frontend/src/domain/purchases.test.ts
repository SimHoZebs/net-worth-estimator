import { describe, expect, it } from "vitest";
import {
	backendToDisplayPlan,
	displayPlanToBackendDocument,
} from "../api/adapter.ts";
import { accountTransactions } from "./accountActivity.ts";
import { isHistoricalMovement, type Movement, validatePlan } from "./model.ts";
import { movePurchase, purchaseQueue } from "./purchases.ts";
import { testPlan } from "../test/plan.ts";
import { projectionFixture } from "../test/projection.ts";

function wish(id: string, priority: number): Movement {
	return {
		...testPlan.movements[0]!,
		id,
		name: id,
		amount: 500,
		fromId: "checking",
		toId: null,
		frequency: "once",
		startDate: testPlan.startDate,
		annualIncrease: 0,
		purchasePriority: priority,
	};
}

describe("purchase queue", () => {
	it("changes priorities without changing established payments or the input", () => {
		const plan = {
			...testPlan,
			movements: [...testPlan.movements, wish("laptop", 4), wish("chair", 9)],
		};
		const next = movePurchase(plan, "chair", -1);
		expect(purchaseQueue(next.movements).map((item) => item.id)).toEqual([
			"chair",
			"laptop",
		]);
		expect(purchaseQueue(plan.movements).map((item) => item.id)).toEqual([
			"laptop",
			"chair",
		]);
		expect(next.movements[0]).toBe(plan.movements[0]);
		expect(movePurchase(next, "chair", -1)).toBe(next);
		expect(movePurchase(next, "missing", 1)).toBe(next);
	});

	it("round-trips wish-list posting metadata through saved and exported plans", () => {
		const plan = {
			...testPlan,
			movements: [...testPlan.movements, wish("laptop", 3)],
		};
		const converted = displayPlanToBackendDocument(plan, {
			presentation: {
				name: plan.name,
				origin: plan.origin,
				updatedAt: plan.updatedAt,
				revision: plan.revision,
				assumptions: plan.assumptions,
				accounts: {},
				movements: {},
			},
		});
		expect(converted.report.losses).toEqual([]);
		expect(
			converted.document.postings.find((item) => item.id === "laptop")
				?.purchase,
		).toEqual({ priority: 3 });
		const loaded = backendToDisplayPlan({
			document: converted.document,
			status: { readOnly: false, authEnabled: false },
		});
		converted.document.evaluations.plannedPurchases = [
			{
				instanceId: "saved-purchases",
				name: "Purchases",
				enabled: true,
				config: {},
			},
		];
		const purchase = loaded.plan.movements.find(
			(item) => item.id === "laptop",
		)!;
		expect(purchase.purchasePriority).toBe(3);
		expect(isHistoricalMovement(purchase, "2030-01-01")).toBe(false);
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
		const plan = { ...testPlan, movements: [wish("laptop", 0)] };
		const activity = accountTransactions({
			accountId: "checking",
			plan,
			projection: projectionFixture(),
		});
		expect(activity).toEqual([]);
	});

	it("rejects recurring wishes, missing funding accounts, and occurrence claims", () => {
		for (const patch of [
			{ frequency: "monthly" as const },
			{ fromId: null },
			{ claimRuleId: "pay" },
			{ amount: 0 },
			{ amountKnown: false },
		]) {
			expect(
				validatePlan({
					...testPlan,
					movements: [{ ...wish("laptop", 0), ...patch }],
				}),
			).toBeInstanceOf(Error);
		}
	});
});
