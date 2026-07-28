import type {
	EvaluationTables,
	FinancialModelDocument,
	ProjectionRuntimeSettings,
} from "../types/model";

export function labelNeutralEvaluations(
	evaluations: EvaluationTables,
): EvaluationTables {
	return {
		financialIndependence: evaluations.financialIndependence.map((item) => ({
			...item,
			label: "",
		})),
		netWorthThreshold: evaluations.netWorthThreshold.map((item) => ({
			...item,
			label: "",
		})),
		postingFulfillment: evaluations.postingFulfillment.map((item) => ({
			...item,
			label: "",
		})),
	};
}

export function projectionComputationSettings(
	settings: ProjectionRuntimeSettings,
): ProjectionRuntimeSettings {
	return {
		fallbackProjectionStartDate: settings.fallbackProjectionStartDate,
		horizonYears: settings.horizonYears,
		evaluations: labelNeutralEvaluations(settings.evaluations),
	};
}

export function evaluationComputationDescriptor(evaluations: EvaluationTables) {
	const describe = <
		T extends { instanceId: string; enabled: boolean; config: unknown },
	>(
		item: T,
	) => ({
		instanceId: item.instanceId,
		enabled: item.enabled,
		config: item.enabled ? item.config : null,
	});
	return {
		financialIndependence: evaluations.financialIndependence.map(describe),
		netWorthThreshold: evaluations.netWorthThreshold.map(describe),
		postingFulfillment: evaluations.postingFulfillment.map(describe),
	};
}

export function simulationDocument(
	document: FinancialModelDocument,
): Omit<FinancialModelDocument, "sourcePath" | "evaluations"> {
	return {
		accounts: document.accounts,
		postings: document.postings,
	};
}
