import type {
	EvaluationResultCollection,
	EvaluationTables,
	ProjectionResult,
} from "../types/model";
import type {
	StochasticProgress,
	StochasticProjectionResult,
} from "../types/stochastic";

function labelResultCollection<T extends EvaluationResultCollection>(
	result: T,
	evaluations: EvaluationTables,
): T {
	return {
		...result,
		evaluations: {
			financialIndependence: result.evaluations.financialIndependence.map(
				(envelope) => ({
					...envelope,
					label:
						evaluations.financialIndependence.find(
							(item) => item.instanceId === envelope.instanceId,
						)?.label ?? envelope.label,
				}),
			),
			netWorthThreshold: result.evaluations.netWorthThreshold.map(
				(envelope) => ({
					...envelope,
					label:
						evaluations.netWorthThreshold.find(
							(item) => item.instanceId === envelope.instanceId,
						)?.label ?? envelope.label,
				}),
			),
			postingFulfillment: result.evaluations.postingFulfillment.map(
				(envelope) => ({
					...envelope,
					label:
						evaluations.postingFulfillment.find(
							(item) => item.instanceId === envelope.instanceId,
						)?.label ?? envelope.label,
				}),
			),
		},
	};
}

export function labelProjectionResult(
	result: ProjectionResult,
	evaluations: EvaluationTables,
): ProjectionResult {
	return labelResultCollection(result, evaluations);
}

export function labelStochasticResult(
	result: StochasticProjectionResult,
	evaluations: EvaluationTables,
): StochasticProjectionResult {
	return {
		...labelResultCollection(result, evaluations),
		deterministic: labelResultCollection(result.deterministic, evaluations),
	};
}

export function labelStochasticProgress(
	progress: StochasticProgress,
	evaluations: EvaluationTables,
): StochasticProgress {
	return {
		...progress,
		evaluationWorkloads: progress.evaluationWorkloads.map((workload) => ({
			...workload,
			label:
				evaluations[workload.type].find(
					(item) => item.instanceId === workload.instanceId,
				)?.label ?? workload.label,
		})),
	};
}
