import type {
	FinancialModelDocument,
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";

export interface ProjectionRequest {
	document: FinancialModelDocument;
	incomeData?: IncomeDataSnapshot;
	projectionSettings: ProjectionRuntimeSettings;
	signal?: AbortSignal;
}

export interface StochasticRequest extends ProjectionRequest {
	config: StochasticConfig;
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
