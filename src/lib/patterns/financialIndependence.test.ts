import { describe, expect, it } from "vitest";
import {
	createFinancialIndependencePlan,
	STARTER_FINANCIAL_INDEPENDENCE_TEMPLATE_INPUT,
} from "./financialIndependence";

describe("financial independence template", () => {
	it("creates an explicit starter plan without labor income", () => {
		const plan = createFinancialIndependencePlan(
			STARTER_FINANCIAL_INDEPENDENCE_TEMPLATE_INPUT,
		);

		expect(plan.minimumNetWorth).toBe(1_500_000);
		expect(plan.annualExpenseTarget).toBe(70_000);
		expect(plan.annualExpenseTargetBasis).toBe("fi-date-dollars");
		expect(plan.sources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "asset", accountId: "k401" }),
				expect.objectContaining({ type: "asset", accountId: "brokerage" }),
			]),
		);
		expect(plan.sources.some((source) => source.type === "cashflow")).toBe(
			false,
		);
		expect(plan.continuingPostingIds).toContain("brokerage_growth");
	});

	it("returns independent continuing-posting arrays", () => {
		const first = createFinancialIndependencePlan(
			STARTER_FINANCIAL_INDEPENDENCE_TEMPLATE_INPUT,
		);
		const second = createFinancialIndependencePlan(
			STARTER_FINANCIAL_INDEPENDENCE_TEMPLATE_INPUT,
		);

		first.continuingPostingIds.push("temporary");
		expect(second.continuingPostingIds).not.toContain("temporary");
	});
});
