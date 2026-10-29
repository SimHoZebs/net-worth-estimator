import { describe, expect, it } from "vitest";
import { testPlan } from "../mocks/plan.ts";
import {
	addMonthsClamped,
	markAsInstallment,
	markAsSubscription,
} from "./subscriptions.ts";

describe("mark as subscription", () => {
	it("creates an ongoing monthly rule and claims the original", () => {
		const next = markAsSubscription(testPlan, "renovation", {
			ruleId: "renovation-sub",
		});
		if (next instanceof Error) throw next;
		expect(next.transactions).toHaveLength(testPlan.transactions.length + 1);
		const original = next.transactions.find((item) => item.id === "renovation");
		const rule = next.transactions.find((item) => item.id === "renovation-sub");
		expect(original?.claimRuleId).toBe("renovation-sub");
		expect(original?.claimOccurrenceDate).toBe(original?.startDate);
		expect(rule).toMatchObject({
			name: "Home renovation",
			amount: 48000,
			fromId: "checking",
			toId: null,
			frequency: "monthly",
			startDate: "2028-06-15",
			endDate: null,
			enabled: true,
		});
		// Source plan is untouched.
		expect(
			testPlan.transactions.find((item) => item.id === "renovation")
				?.claimRuleId,
		).toBeNull();
	});

	it("rejects recurring sources and already-claimed transactions", () => {
		expect(markAsSubscription(testPlan, "invest")).toBeInstanceOf(Error);
		const claimed = markAsSubscription(testPlan, "renovation", {
			ruleId: "reno-sub",
		});
		if (claimed instanceof Error) throw claimed;
		expect(markAsSubscription(claimed, "renovation")).toBeInstanceOf(Error);
	});

	it("supports installments as a rule with a deadline", () => {
		const next = markAsInstallment(testPlan, "renovation", 4, {
			ruleId: "reno-split",
		});
		if (next instanceof Error) throw next;
		const rule = next.transactions.find((item) => item.id === "reno-split");
		expect(rule?.frequency).toBe("monthly");
		expect(rule?.endDate).toBe("2028-09-15");
		expect(
			next.transactions.find((item) => item.id === "renovation")?.claimRuleId,
		).toBe("reno-split");
	});

	it("rejects invalid payment counts and clamps month ends", () => {
		expect(markAsInstallment(testPlan, "renovation", 1)).toBeInstanceOf(Error);
		expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
		expect(addMonthsClamped("2028-01-31", 3)).toBe("2028-04-30");
	});
});
