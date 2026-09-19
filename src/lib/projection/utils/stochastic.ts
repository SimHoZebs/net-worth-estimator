import {
	evaluationComputationDescriptor,
	simulationDocument,
} from "../runtime/computationIdentity";
import type { IncomeDataSnapshot } from "../types/income";
import type {
	FinancialModelDocument,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { StochasticConfig } from "../types/stochastic";
import { canonicalSerialize } from "./canonical";

export function normalizeStochasticConfig(
	config: StochasticConfig,
): StochasticConfig {
	return {
		...config,
		runCount: Number.isFinite(config.runCount)
			? Math.max(1, Math.min(10_000, Math.trunc(config.runCount)))
			: 1,
	};
}

/**
 * Derive a deterministic Monte Carlo seed from the computation inputs.
 * Identical models share identical draws, so results are cacheable,
 * resumable, and stable across refreshes. An explicit user seed always wins;
 * this only fills the blank (auto) case. Output is a 31-bit non-negative
 * integer, matching the LCG state range on both implementations.
 */
export function deriveStochasticSeed(options: {
	document: FinancialModelDocument | null;
	settings: ProjectionRuntimeSettings;
	incomeData?: IncomeDataSnapshot;
	runCount: number;
}): number {
	const fingerprint = canonicalSerialize({
		document: options.document ? simulationDocument(options.document) : null,
		settings: {
			fallbackProjectionStartDate: options.settings.fallbackProjectionStartDate,
			horizonYears: options.settings.horizonYears,
			evaluations: evaluationComputationDescriptor(
				options.settings.evaluations,
			),
		},
		incomeData: options.incomeData ?? null,
		runCount: options.runCount,
	});
	return fnv1a31(fingerprint);
}

function fnv1a31(input: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index++) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash & 0x7fffffff;
}
