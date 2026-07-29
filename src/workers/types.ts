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

type WorkerRecord = Record<string, unknown>;

function isWorkerRecord(value: unknown): value is WorkerRecord {
	return typeof value === "object" && value !== null;
}

function hasOwn(value: WorkerRecord, key: string): boolean {
	return Reflect.apply(Object.prototype.hasOwnProperty, value, [key]);
}

export type ProjectionWorkerResponseEnvelope = Omit<
	ProjectionWorkerResponse,
	"result"
> & { result: unknown };

export function isProjectionWorkerResponseEnvelope(
	value: unknown,
): value is ProjectionWorkerResponseEnvelope {
	if (!isWorkerRecord(value)) return false;

	return (
		typeof value.id === "number" &&
		(value.type === "complete" ||
			value.type === "base" ||
			value.type === "evaluation") &&
		hasOwn(value, "result") &&
		hasOwn(value, "runtimeError") &&
		(value.runtimeError === null || typeof value.runtimeError === "string")
	);
}

export type StochasticWorkerProgressEnvelope = Omit<
	StochasticWorkerProgress,
	"partial"
> & { partial?: unknown };

export function isStochasticWorkerProgressEnvelope(
	value: unknown,
): value is StochasticWorkerProgressEnvelope {
	if (!isWorkerRecord(value)) return false;

	return (
		value.type === "progress" &&
		typeof value.id === "number" &&
		typeof value.progress === "number"
	);
}

export type StochasticWorkerResponseEnvelope = Omit<
	StochasticWorkerResponse,
	"result"
> & { result: unknown };

export function isStochasticWorkerResponseEnvelope(
	value: unknown,
): value is StochasticWorkerResponseEnvelope {
	if (!isWorkerRecord(value)) return false;

	return (
		value.type === "result" &&
		typeof value.id === "number" &&
		hasOwn(value, "result") &&
		hasOwn(value, "runtimeError") &&
		(value.runtimeError === null || typeof value.runtimeError === "string")
	);
}
