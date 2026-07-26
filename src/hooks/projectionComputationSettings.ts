import type {
	EvaluationResultCollection,
	EvaluationTables,
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticProjectionResult,
} from "@/lib/projection";

export function projectionComputationSettingsKey(
	settings: ProjectionRuntimeSettings,
) {
	return JSON.stringify({
		fallbackProjectionStartDate: settings.fallbackProjectionStartDate,
		horizonYears: settings.horizonYears,
		evaluations: {
			financialIndependence: settings.evaluations.financialIndependence.map(
				({ instanceId, enabled, config }) => ({
					instanceId,
					label: "",
					enabled,
					config,
				}),
			),
			netWorthThreshold: settings.evaluations.netWorthThreshold.map(
				({ instanceId, enabled, config }) => ({
					instanceId,
					label: "",
					enabled,
					config,
				}),
			),
			postingFulfillment: settings.evaluations.postingFulfillment.map(
				({ instanceId, enabled, config }) => ({
					instanceId,
					label: "",
					enabled,
					config,
				}),
			),
		},
	} satisfies ProjectionRuntimeSettings);
}

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
) {
	return labelResultCollection(result, evaluations);
}

export function labelStochasticResult(
	result: StochasticProjectionResult,
	evaluations: EvaluationTables,
) {
	return {
		...labelResultCollection(result, evaluations),
		deterministic: labelResultCollection(result.deterministic, evaluations),
	};
}
