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
	StochasticProjectionResult,
} from "@/lib/projection";

interface ProjectionDocumentWorkerRequest {
	id: number;
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
}

export interface CompleteProjectionWorkerRequest
	extends ProjectionDocumentWorkerRequest {
	type: "complete";
}

export interface BaseProjectionWorkerRequest
	extends ProjectionDocumentWorkerRequest {
	type: "base";
}

export interface EvaluationProjectionWorkerRequest {
	id: number;
	type: "evaluation";
	path: ProjectionPath;
	evaluations: EvaluationTables;
}

export type ProjectionWorkerRequest =
	| CompleteProjectionWorkerRequest
	| BaseProjectionWorkerRequest
	| EvaluationProjectionWorkerRequest;

export interface ProjectionWorkerResponse {
	id: number;
	type: ProjectionWorkerRequest["type"];
	result:
		| ProjectionResult
		| RawProjectionOutput
		| EvaluationResultCollection
		| null;
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
