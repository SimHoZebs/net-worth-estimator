import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";

export interface ProjectionWorkerRequest {
	id: number;
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
}

export interface ProjectionWorkerResponse {
	id: number;
	result: ProjectionResult | null;
	runtimeError: string | null;
}

export interface StochasticWorkerRequest {
	id: number;
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	config: StochasticConfig;
}

export interface StochasticWorkerProgress {
	id: number;
	progress: number;
	type: "progress";
	partial?: StochasticProjectionResult;
}

export interface StochasticWorkerResponse {
	id: number;
	result: StochasticProjectionResult | null;
	runtimeError: string | null;
	type: "result";
}
