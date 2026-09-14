import { describe, expect, it } from "vitest";
import {
	buildFinancialIndependenceCandidateDates,
	validateFinancialIndependencePlan,
} from "../evaluation/financialIndependence";
import type { FinancialIndependencePlan } from "../types/model";

function plan(
	overrides: Partial<FinancialIndependencePlan> = {},
): FinancialIndependencePlan {
	return {
		minimumNetWorth: 0,
		annualExpenseTarget: 1_200,
		annualExpenseTargetBasis: "fi-date-dollars",
		annualExpenseGrowthRate: 0,
		withdrawalRate: 0.04,
		evaluationYears: 1,
		requiredConfidence: 0.9,
		sources: [],
		continuingPostingIds: [],
		principalPolicy: "allow-drawdown",
		...overrides,
	};
}

describe("financial independence configuration", () => {
	it("rejects malformed optional source properties", () => {
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				sources: [
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: Number.POSITIVE_INFINITY,
					},
				],
			}),
		).toThrow("Financial independence configuration is invalid.");
	});

	it("rejects unknown source fields", () => {
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				sources: [
					{
						type: "cashflow",
						postingId: "pension",
						included: true,
						unexpected: true,
					},
				],
			}),
		).toThrow("Financial independence configuration is invalid.");
	});

	it("defaults a missing expense basis and rejects invalid explicit values", () => {
		const { annualExpenseTargetBasis: _missing, ...legacyPlan } = plan();

		expect(
			validateFinancialIndependencePlan(legacyPlan).annualExpenseTargetBasis,
		).toBe("projection-start-purchasing-power");
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				annualExpenseTargetBasis: "future-dollars",
			}),
		).toThrow("Financial independence configuration is invalid.");
	});

	it("normalizes overlapping income and continuing posting treatment", () => {
		const normalized = validateFinancialIndependencePlan({
			...plan(),
			sources: [{ type: "cashflow", postingId: "pension", included: true }],
			continuingPostingIds: ["pension", "portfolio-growth"],
		});

		expect(normalized.continuingPostingIds).toEqual(["portfolio-growth"]);
	});

	it("uses one canonical monthly candidate schedule", () => {
		expect(
			buildFinancialIndependenceCandidateDates("2026-01-31", "2027-04-30", 1),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
	});
});
