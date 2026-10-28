import type {
	EvaluationResultEnvelope,
	FinancialIndependenceEvaluation,
	JsonValue,
} from "../api/contracts.ts";
import { financialIndependenceEvaluation } from "../api/financialIndependence.ts";
import { modelFixture } from "./waypointServer.ts";

export function independenceRow(
	date = "2036-02-01",
	overrides: Record<string, JsonValue> = {},
) {
	return {
		date,
		netWorth: 1500000,
		minimumNetWorth: 1000000,
		minimumNetWorthMet: true,
		annualDirectIncome: 20000,
		annualWithdrawalCapacity: 40000,
		totalAnnualCapacity: 60000,
		annualExpenseTarget: 80000,
		coverageRatio: 0.75,
		isCovered: false,
		isEligible: false,
		selectedAssetBalance: 1000000,
		assetContributions: [
			{
				accountId: "cash",
				balance: 1000000,
				withdrawalRate: 0.04,
				annualWithdrawalCapacity: 40000,
			},
		],
		...overrides,
	};
}

export function independenceEnvelope(
	deterministic: JsonValue = {
		rows: [
			independenceRow("2026-02-01", {
				coverageRatio: 0.5,
				totalAnnualCapacity: 40000,
				annualWithdrawalCapacity: 20000,
			}),
			independenceRow(),
		],
		runOutcomes: [
			{
				candidateDate: "2036-02-01",
				status: "ineligible",
				minimumNetWorthMet: true,
				initialCoverageMet: false,
				cycleEstablished: false,
				expensesFullyCovered: false,
				principalReplenished: false,
				balanceTrajectory: [],
				withdrawals: { firstShortfall: null },
			},
		],
		milestones: { firstCoverageDate: null, firstSelfSustainingDate: null },
	},
): EvaluationResultEnvelope {
	return {
		instanceId: "financial-independence",
		name: "Financial independence",
		status: "not-satisfied",
		deterministic,
		probabilistic: null,
		diagnostics: [],
	};
}

export function independenceConfig(
	overrides: Record<string, JsonValue> = {},
): FinancialIndependenceEvaluation {
	return {
		instanceId: "financial-independence",
		name: "Financial independence",
		enabled: true,
		config: {
			minimumNetWorth: 1000000,
			annualExpenseTarget: 80000,
			annualExpenseGrowthRate: 0.025,
			withdrawalRate: 0.04,
			evaluationYears: 10,
			requiredConfidence: 0.9,
			principalPolicy: "preserve-real-principal",
			annualExpenseTargetBasis: "fi-date-dollars",
			sources: [{ type: "asset", accountId: "cash", included: true }],
			continuingPostingIds: [],
			...overrides,
		},
	};
}

export function independenceItem(
	envelope = independenceEnvelope(),
	config = independenceConfig(),
) {
	return financialIndependenceEvaluation(
		config,
		envelope,
		modelFixture(),
		"2026-02-01",
		"2046-02-01",
	);
}

export function detailedIndependenceOutcome(
	overrides: Record<string, JsonValue> = {},
) {
	return {
		candidateDate: "2036-02-01",
		status: "evaluated",
		minimumNetWorthMet: true,
		initialCoverageMet: true,
		cycleEstablished: false,
		expensesFullyCovered: false,
		hadWithdrawalShortfall: true,
		principalReplenished: false,
		startingSelectedAssetBalance: 1000000,
		endingSelectedAssetBalance: 1100000,
		endingRealSelectedAssetBalance: 850000,
		balanceTrajectory: [
			{
				date: "2036-02-01",
				accounts: [{ accountId: "cash", balance: 1000000 }],
			},
			{
				date: "2046-02-01",
				accounts: [{ accountId: "cash", balance: 1100000 }],
			},
		],
		withdrawals: {
			firstShortfallDate: "2040-03-01",
			firstShortfall: {
				date: "2040-03-01",
				requestedAmount: 5000,
				realizedAmount: 3000,
				shortfallAmount: 2000,
				constraints: ["source-floor", "action-limit"],
				relatedAccountIds: ["cash"],
			},
		},
		...overrides,
	};
}
