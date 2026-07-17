import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	ScenarioWhatIfState,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";

export interface ProjectionRequest {
	pack: ScenarioPack;
	projectionSettings: ProjectionRuntimeSettings;
	whatIfState: ScenarioWhatIfState;
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
