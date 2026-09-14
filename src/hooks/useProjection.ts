import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "@/lib/projection";
import { labelProjectionResult } from "@/lib/projection/runtime/resultLabels";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import type { ProjectionHookState } from "./types";
import { useEngineRequest } from "./useEngineRequest";

export type { ProjectionHookState };

export function useProjection(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<ProjectionResult> {
	return useEngineRequest<ProjectionResult, number>({
		document,
		projectionSettings,
		overrides,
		active: enabled,
		incomeData,
		execute: (engine, input) => engine.project(input),
		labelResult: labelProjectionResult,
		failureMessage: "Projection failed.",
	});
}
