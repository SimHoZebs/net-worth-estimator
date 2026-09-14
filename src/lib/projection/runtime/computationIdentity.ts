import { applyModelOverrides } from "../model/applyModelOverrides";
import type { IncomeDataSnapshot } from "../types/income";
import type {
	EvaluationTables,
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "../types/model";
import { canonicalSerialize } from "../utils/canonical";

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

// The server ignores evaluation labels for cache identity (its artifact
// descriptor strips labels and disabled configs), so the client request key
// uses this label-neutral descriptor while request bodies pass labels
// through for labeled result envelopes.
export function projectionRequestIdentity(options: {
	document: FinancialModelDocument | null;
	overrides: ModelOverrides;
	settings: ProjectionRuntimeSettings;
	incomeData?: IncomeDataSnapshot;
	extra?: unknown;
}): string {
	return canonicalSerialize({
		document: options.document
			? simulationDocument(
					applyModelOverrides(options.document, options.overrides),
				)
			: null,
		settings: {
			fallbackProjectionStartDate: options.settings.fallbackProjectionStartDate,
			horizonYears: options.settings.horizonYears,
			evaluations: evaluationComputationDescriptor(
				options.settings.evaluations,
			),
		},
		extra: options.extra ?? null,
		incomeData: options.incomeData ?? null,
	});
}

export function simulationDocument(
	document: FinancialModelDocument,
): Pick<FinancialModelDocument, "accounts" | "checkpoints" | "postings"> {
	return {
		accounts: document.accounts,
		checkpoints: document.checkpoints,
		postings: document.postings,
	};
}
