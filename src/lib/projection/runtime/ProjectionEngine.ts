import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";

export interface ProjectionRequest {
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	signal?: AbortSignal;
}

export interface StochasticRequest extends ProjectionRequest {
	config: StochasticConfig;
}

export type ProgressCallback = (
	progress: number,
	partial?: StochasticProjectionResult,
) => void;

export interface ProjectionEngine {
	project(request: ProjectionRequest): Promise<ProjectionResult>;
	projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult>;
}
