import { useMemo } from "react";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	labelStochasticProgress,
	labelStochasticResult,
} from "@/lib/projection/runtime/resultLabels";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import type { ProjectionHookState } from "./types";
import { useEngineRequest } from "./useEngineRequest";

export function useStochastic(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	config: StochasticConfig | null,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	const runCount = config?.runCount ?? null;
	const seed = config?.seed ?? null;
	const stableConfig = useMemo(
		() =>
			runCount === null ? null : normalizeStochasticConfig({ runCount, seed }),
		[runCount, seed],
	);
	return useEngineRequest<StochasticProjectionResult, StochasticProgress>({
		document,
		projectionSettings,
		overrides,
		active: enabled && stableConfig !== null,
		extraKey: stableConfig,
		incomeData,
		execute: (engine, input, onProgress) => {
			if (stableConfig === null)
				throw new DOMException("Aborted", "AbortError");
			return engine.projectStochastic(
				{ ...input, config: stableConfig },
				onProgress,
			);
		},
		labelResult: labelStochasticResult,
		labelProgress: labelStochasticProgress,
		failureMessage: "Stochastic simulation failed.",
	});
}
