import type { FinancialIndependencePlan } from "@/lib/projection";
import type { FinancialIndependenceTemplateInput } from "./types";

/**
 * Starter FI assumptions for the bundled scenario in public/scenario.
 * IDs are explicit so growth and spendable income are never inferred.
 */
export const STARTER_FINANCIAL_INDEPENDENCE_TEMPLATE_INPUT: FinancialIndependenceTemplateInput =
	{
		minimumNetWorth: 1_500_000,
		annualExpenseTarget: 70_000,
		annualExpenseGrowthRate: 0.025,
		withdrawalRate: 0.04,
		evaluationYears: 10,
		requiredConfidence: 0.9,
		directIncomePostingIds: [],
		assets: [
			{ accountId: "k401" },
			{ accountId: "brokerage" },
			{ accountId: "roth_ira" },
			{ accountId: "rsu_vested" },
		],
		continuingPostingIds: [
			"k401_growth",
			"brokerage_growth",
			"roth_ira_growth",
			"rsu_vested_growth",
		],
		principalPolicy: "preserve-real-principal",
	};

export function createFinancialIndependencePlan(
	input: FinancialIndependenceTemplateInput,
): FinancialIndependencePlan {
	return {
		minimumNetWorth: input.minimumNetWorth,
		annualExpenseTarget: input.annualExpenseTarget,
		annualExpenseGrowthRate: input.annualExpenseGrowthRate,
		withdrawalRate: input.withdrawalRate,
		evaluationYears: input.evaluationYears,
		requiredConfidence: input.requiredConfidence,
		sources: [
			...input.directIncomePostingIds.map((postingId) => ({
				type: "cashflow" as const,
				postingId,
				included: true,
			})),
			...input.assets.map((asset) => ({
				type: "asset" as const,
				accountId: asset.accountId,
				included: true,
				withdrawalRateOverride: asset.withdrawalRateOverride,
			})),
		],
		continuingPostingIds: [...input.continuingPostingIds],
		principalPolicy: input.principalPolicy,
	};
}
