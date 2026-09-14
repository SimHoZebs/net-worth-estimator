import type { FinancialIndependencePlan, IsoDate } from "../types/model";
import { addMonthsClamped, addYearsClamped } from "../utils/date";

export const FINANCIAL_INDEPENDENCE_DEFINITION_ID = "financial-independence";

export interface FinancialIndependenceProbabilisticResult {
	fiCycleSuccessProbability: number;
	medianCoverageDate: IsoDate | null;
	selfSustainingDate: IsoDate | null;
	selfSustainingProbability: number | null;
}

export const DEFAULT_FI_PLAN: FinancialIndependencePlan = {
	minimumNetWorth: 0,
	annualExpenseTarget: 0,
	annualExpenseTargetBasis: "fi-date-dollars",
	annualExpenseGrowthRate: 0,
	withdrawalRate: 0,
	evaluationYears: 1,
	requiredConfidence: 1,
	sources: [],
	continuingPostingIds: [],
	principalPolicy: "allow-drawdown",
};

function finiteNonNegative(value: number, fallback = 0): number {
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function normalizeFinancialIndependencePlan(
	plan: FinancialIndependencePlan,
): FinancialIndependencePlan {
	const sources = plan.sources.map((source) => {
		if (source.type === "cashflow") {
			return {
				type: "cashflow" as const,
				postingId: source.postingId,
				included: source.included,
			};
		}
		return source.withdrawalRateOverride === undefined
			? source
			: {
					...source,
					withdrawalRateOverride: Math.min(
						1,
						finiteNonNegative(source.withdrawalRateOverride),
					),
				};
	});
	const spendableIncomeIds = new Set(
		sources.flatMap((source) =>
			source.type === "cashflow" && source.included ? [source.postingId] : [],
		),
	);
	return {
		...plan,
		minimumNetWorth: finiteNonNegative(plan.minimumNetWorth),
		annualExpenseTarget: finiteNonNegative(plan.annualExpenseTarget),
		annualExpenseTargetBasis:
			plan.annualExpenseTargetBasis === "fi-date-dollars"
				? "fi-date-dollars"
				: "projection-start-purchasing-power",
		annualExpenseGrowthRate: finiteNonNegative(plan.annualExpenseGrowthRate),
		withdrawalRate: Math.min(1, finiteNonNegative(plan.withdrawalRate)),
		evaluationYears: Math.max(
			1,
			Math.floor(finiteNonNegative(plan.evaluationYears, 1)),
		),
		requiredConfidence: Math.min(
			1,
			Math.max(0.01, finiteNonNegative(plan.requiredConfidence, 1)),
		),
		sources,
		continuingPostingIds: [...new Set(plan.continuingPostingIds)].filter(
			(postingId) => !spendableIncomeIds.has(postingId),
		),
	};
}

export function buildFinancialIndependenceCandidateDates(
	projectionStartDate: IsoDate,
	projectionEndDate: IsoDate,
	evaluationYears: number,
): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let month = 0; ; month++) {
		const date = addMonthsClamped(projectionStartDate, month);
		if (addYearsClamped(date, evaluationYears) > projectionEndDate) break;
		dates.push(date);
	}
	return dates;
}

export function validateFinancialIndependencePlan(
	config: unknown,
): FinancialIndependencePlan {
	if (
		typeof config !== "object" ||
		config === null ||
		!("sources" in config) ||
		!Array.isArray(config.sources) ||
		!config.sources.every((source) => {
			if (typeof source !== "object" || source === null) return false;
			if (!("type" in source) || !("included" in source)) return false;
			if (typeof source.included !== "boolean") return false;

			if (source.type === "cashflow") {
				return (
					Object.keys(source).every((key) =>
						["type", "postingId", "included"].includes(key),
					) &&
					"postingId" in source &&
					typeof source.postingId === "string"
				);
			}
			return (
				source.type === "asset" &&
				Object.keys(source).every((key) =>
					["type", "accountId", "included", "withdrawalRateOverride"].includes(
						key,
					),
				) &&
				"accountId" in source &&
				typeof source.accountId === "string" &&
				(!("withdrawalRateOverride" in source) ||
					(typeof source.withdrawalRateOverride === "number" &&
						Number.isFinite(source.withdrawalRateOverride)))
			);
		}) ||
		!("continuingPostingIds" in config) ||
		!Array.isArray(config.continuingPostingIds) ||
		!config.continuingPostingIds.every((id) => typeof id === "string") ||
		!("principalPolicy" in config) ||
		!(
			[
				"allow-drawdown",
				"preserve-nominal-principal",
				"preserve-real-principal",
			] as unknown[]
		).includes(config.principalPolicy) ||
		("annualExpenseTargetBasis" in config &&
			!(
				["projection-start-purchasing-power", "fi-date-dollars"] as unknown[]
			).includes(config.annualExpenseTargetBasis))
	) {
		throw new Error("Financial independence configuration is invalid.");
	}
	const numericKeys = [
		"minimumNetWorth",
		"annualExpenseTarget",
		"annualExpenseGrowthRate",
		"withdrawalRate",
		"evaluationYears",
		"requiredConfidence",
	] as const;
	const record = config as Record<string, unknown>;
	for (const key of numericKeys) {
		if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
			throw new Error(`Financial independence ${key} must be a finite number.`);
		}
	}
	return normalizeFinancialIndependencePlan(
		config as unknown as FinancialIndependencePlan,
	);
}
