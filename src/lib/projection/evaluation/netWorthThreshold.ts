import type {
	IsoDate,
	NetWorthThresholdConfig,
	ProjectionPath,
} from "../types/model";
import type { EvaluationDefinition } from "./runtime";

export const NET_WORTH_THRESHOLD_DEFINITION_ID = "net-worth-threshold";

export interface NetWorthThresholdPathResult {
	reached: boolean;
	firstReachedDate: IsoDate | null;
}

export interface NetWorthThresholdProbabilisticResult {
	probability: number;
	p10ReachedDate: IsoDate | null;
	medianReachedDate: IsoDate | null;
	p90ReachedDate: IsoDate | null;
}

interface ThresholdAccumulator {
	reachedDates: IsoDate[];
	totalRuns: number;
}

export function evaluateNetWorthThreshold(
	path: ProjectionPath,
	target: number,
): NetWorthThresholdPathResult {
	const firstReachedDate =
		path.rows.find((row) => !row.isHistorical && row.netWorth >= target)
			?.date ?? null;
	return {
		reached: firstReachedDate !== null,
		firstReachedDate,
	};
}

export function validateNetWorthThresholdConfig(
	config: unknown,
): NetWorthThresholdConfig {
	if (
		typeof config !== "object" ||
		config === null ||
		!("target" in config) ||
		typeof config.target !== "number" ||
		!Number.isFinite(config.target)
	) {
		throw new Error("Net worth threshold target must be a finite number.");
	}
	return { target: config.target };
}

function datePercentile(sortedDates: readonly IsoDate[], percentile: number) {
	if (sortedDates.length === 0) return null;
	return sortedDates[Math.round((sortedDates.length - 1) * percentile)] ?? null;
}

export const netWorthThresholdEvaluation: EvaluationDefinition<
	NetWorthThresholdConfig,
	NetWorthThresholdPathResult,
	ThresholdAccumulator,
	NetWorthThresholdProbabilisticResult
> = {
	type: "netWorthThreshold",
	label: "Net worth threshold",
	validateConfig: validateNetWorthThresholdConfig,
	evaluatePath({ path }, config) {
		return evaluateNetWorthThreshold(path, config.target);
	},
	createAccumulator() {
		return { reachedDates: [], totalRuns: 0 };
	},
	accumulate(accumulator, pathResult) {
		accumulator.totalRuns++;
		if (pathResult.firstReachedDate) {
			accumulator.reachedDates.push(pathResult.firstReachedDate);
		}
	},
	finalize(accumulator) {
		const dates = [...accumulator.reachedDates].sort();
		return {
			probability:
				accumulator.totalRuns > 0 ? dates.length / accumulator.totalRuns : 0,
			p10ReachedDate: datePercentile(dates, 0.1),
			medianReachedDate: datePercentile(dates, 0.5),
			p90ReachedDate: datePercentile(dates, 0.9),
		};
	},
	status(deterministic, probabilistic) {
		return probabilistic
			? probabilistic.probability >= 0.5
				? "satisfied"
				: "not-satisfied"
			: deterministic?.reached
				? "satisfied"
				: "not-satisfied";
	},
};
