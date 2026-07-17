import type { ProjectionRuntimeSettings } from "../types/scenario";

export function makeSettings(
	overrides: Partial<ProjectionRuntimeSettings> = {},
): ProjectionRuntimeSettings {
	return {
		targetNetWorth: 5000,
		fallbackProjectionStartDate: "2026-01-01",
		horizonYears: 1,
		financialIndependencePlan: {
			annualExpenseTarget: 40_000,
			annualExpenseGrowthRate: 0.025,
			withdrawalRate: 0.04,
			evaluationYears: 1,
			requiredConfidence: 0.9,
			sources: [],
			principalPolicy: "preserve-real-principal",
		},
		...overrides,
	};
}
