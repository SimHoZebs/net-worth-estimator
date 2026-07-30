import type {
	EvaluationResultCollection,
	EvaluationType,
	IsoDate,
	ProjectionResult,
} from "./model";

export interface StochasticConfig {
	runCount: number;
	seed: number | null;
}

export type StochasticProgressPhase =
	| "preparing"
	| "deterministic-evaluations"
	| "stochastic-runs";

export interface StochasticEvaluationWorkload {
	type: EvaluationType;
	instanceId: string;
	label: string;
	completedUnits: number;
	totalUnits: number;
	unitLabel: string;
	unitAction: string;
	intensiveUnitsCompleted?: number;
	intensiveUnitLabel?: string;
	intensiveUnitAction?: string;
	description?: string;
}

export interface StochasticProgress {
	phase: StochasticProgressPhase;
	completedRuns: number;
	totalRuns: number;
	fraction: number;
	evaluationWorkloads: StochasticEvaluationWorkload[];
}

export interface PercentileBands {
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
}

export interface StochasticBandRow {
	date: IsoDate;
	isHistorical: boolean;
	netWorth: PercentileBands;
}

export interface StochasticProjectionResult extends EvaluationResultCollection {
	config: StochasticConfig;
	deterministic: ProjectionResult;
	bands: StochasticBandRow[];
	milestones: {
		finalNetWorthPercentiles: PercentileBands;
	};
}
