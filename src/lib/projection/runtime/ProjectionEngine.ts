import type {
	EvaluationResultCollection,
	EvaluationTables,
	FinancialModelDocument,
	ModelOverrides,
	ProjectionPath,
	ProjectionResult,
	ProjectionRuntimeSettings,
	RawProjectionOutput,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";

export interface ProjectionRequest {
	document: FinancialModelDocument;
	incomeData?: IncomeDataSnapshot;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	signal?: AbortSignal;
}

export interface StochasticRequest extends ProjectionRequest {
	config: StochasticConfig;
}

export interface ProjectionEvaluationRequest {
	path: ProjectionPath;
	evaluations: EvaluationTables;
	signal?: AbortSignal;
}

export type ProgressCallback = (
	progress: StochasticProgress,
	partial?: StochasticProjectionResult,
) => void;

export interface ProjectionEngine {
	project(request: ProjectionRequest): Promise<ProjectionResult>;
	projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult>;
}

/** Internal staged worker capability used by the artifact cache. */
export interface ProjectionComputationEngine extends ProjectionEngine {
	projectBase(request: ProjectionRequest): Promise<RawProjectionOutput>;
	evaluateProjection(
		request: ProjectionEvaluationRequest,
	): Promise<EvaluationResultCollection>;
}
