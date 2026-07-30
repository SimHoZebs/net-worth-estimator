import type { ProjectionRuntimeSettings } from "../types/model";

export function makeSettings(
	overrides: Partial<ProjectionRuntimeSettings> = {},
): ProjectionRuntimeSettings {
	return {
		fallbackProjectionStartDate: "2026-02-01",
		horizonYears: 1,
		evaluations: {
			financialIndependence: [
				{
					instanceId: "fi",
					label: "Financial independence",
					enabled: true,
					config: {
						minimumNetWorth: 0,
						annualExpenseTarget: 40_000,
						annualExpenseTargetBasis: "fi-date-dollars",
						annualExpenseGrowthRate: 0.025,
						withdrawalRate: 0.04,
						evaluationYears: 1,
						requiredConfidence: 0.9,
						sources: [],
						continuingPostingIds: [],
						principalPolicy: "preserve-real-principal",
					},
				},
			],
			netWorthThreshold: [
				{
					instanceId: "target",
					label: "Reach target",
					enabled: true,
					config: { target: 5_000 },
				},
			],
			postingFulfillment: [
				{
					instanceId: "posting-fulfillment",
					label: "Posting fulfillment",
					enabled: true,
					config: { postingIds: null },
				},
			],
		},
		...overrides,
	};
}
