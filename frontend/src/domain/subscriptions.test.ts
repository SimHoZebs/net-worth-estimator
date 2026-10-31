import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import {
	addMonthsClamped,
	buildInstallment,
	buildSubscription,
	buildSubscriptionConversion,
	subscriptionSourceError,
} from "./subscriptions.ts";

const renovation = financialModelFixture.transactions.find(
	(item) => item.id === "renovation",
)!;

describe("subscription conversion", () => {
	it("creates an ongoing monthly rule and claims the original", () => {
		const next = buildSubscription(renovation, { ruleId: "renovation-sub" });
		if (next instanceof Error) throw next;
		expect(next.rule).toMatchObject({
			id: "renovation-sub",
			name: "Home renovation",
			amount: 48000,
			fromId: "checking",
			toId: null,
			frequency: "monthly",
			startDate: "2028-06-15",
			endDate: null,
			enabled: true,
		});
		expect(next.claimed).toMatchObject({
			id: "renovation",
			claimRuleId: "renovation-sub",
			claimOccurrenceDate: "2028-06-15",
		});
		// Source row is untouched; callers persist the returned copies.
		expect(renovation.claimRuleId).toBeNull();
	});

	it("rejects recurring sources and already-claimed transactions", () => {
		const recurring = financialModelFixture.transactions.find(
			(item) => item.id === "invest",
		)!;
		expect(buildSubscription(recurring)).toBeInstanceOf(Error);
		expect(subscriptionSourceError(recurring)).toBeInstanceOf(Error);
		const claimed = buildSubscription(renovation, { ruleId: "reno-sub" });
		if (claimed instanceof Error) throw claimed;
		expect(buildSubscription(claimed.claimed)).toBeInstanceOf(Error);
	});

	it("supports installments as a rule with a deadline", () => {
		const next = buildInstallment(renovation, 4, { ruleId: "reno-split" });
		if (next instanceof Error) throw next;
		expect(next.rule.frequency).toBe("monthly");
		expect(next.rule.endDate).toBe("2028-09-15");
		expect(next.claimed.claimRuleId).toBe("reno-split");
	});

	it("rejects invalid payment counts and clamps month ends", () => {
		expect(buildInstallment(renovation, 1)).toBeInstanceOf(Error);
		expect(
			buildSubscriptionConversion(renovation, { endDate: "not-a-date" }),
		).toBeInstanceOf(Error);
		expect(
			buildSubscriptionConversion(renovation, { endDate: "2020-01-01" }),
		).toBeInstanceOf(Error);
		expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
		expect(addMonthsClamped("2028-01-31", 3)).toBe("2028-04-30");
	});

	it("rejects synced settled sources", () => {
		expect(
			subscriptionSourceError({ ...renovation, readOnly: true }),
		).toBeInstanceOf(Error);
		// Pending bank charges may be claimed as a recurring occurrence.
		expect(
			subscriptionSourceError({ ...renovation, pending: true }),
		).toBeNull();
	});
});
