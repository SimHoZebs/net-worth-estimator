import {
	EVALUATION_TYPE_ORDER,
	type EvaluationResultCollection,
	type EvaluationResultEnvelope,
	type EvaluationTables,
	type FinancialModelDocument,
	isJsonValue,
	type ModelOverrides,
	type ProjectionCoreResult,
	type ProjectionPath,
	type ProjectionResult,
	type ProjectionRuntimeSettings,
	parseFinancialModelDocument,
	type RawProjectionOutput,
	type StochasticConfig,
	type StochasticProgress,
	type StochasticProjectionResult,
} from "@/lib/projection";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";

interface ProjectionDocumentWorkerRequest {
	id: number;
	document: FinancialModelDocument;
	incomeData?: IncomeDataSnapshot;
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
	incomeData?: IncomeDataSnapshot;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	config: StochasticConfig;
}

export interface StochasticWorkerProgress {
	id: number;
	progress: StochasticProgress;
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

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function isAccountDelta(value: unknown): boolean {
	return (
		isWorkerRecord(value) &&
		typeof value.accountId === "string" &&
		isFiniteNumber(value.delta)
	);
}

function isPostingDelta(value: unknown): boolean {
	return (
		isWorkerRecord(value) &&
		typeof value.postingId === "string" &&
		isFiniteNumber(value.delta)
	);
}

function isAccountSnapshot(value: unknown): boolean {
	return (
		isWorkerRecord(value) &&
		typeof value.accountId === "string" &&
		typeof value.date === "string" &&
		isFiniteNumber(value.balance) &&
		Array.isArray(value.impacts) &&
		value.impacts.every(isPostingDelta)
	);
}

function isProjectionRow(value: unknown): boolean {
	return (
		isWorkerRecord(value) &&
		typeof value.date === "string" &&
		typeof value.isHistorical === "boolean" &&
		isFiniteNumber(value.netWorth) &&
		Array.isArray(value.accountSnapshots) &&
		value.accountSnapshots.every(isAccountSnapshot) &&
		isFiniteNumber(value.externalInflowAmount) &&
		isFiniteNumber(value.externalOutflowAmount) &&
		isFiniteNumber(value.internalTransferAmount)
	);
}

function isAccountSummary(value: unknown): boolean {
	return (
		isWorkerRecord(value) &&
		typeof value.accountId === "string" &&
		typeof value.label === "string" &&
		isNullableString(value.color) &&
		typeof value.enabled === "boolean" &&
		isFiniteNumber(value.startingBalance) &&
		isFiniteNumber(value.endingBalance)
	);
}

function isMovementEvent(value: unknown): boolean {
	if (!isWorkerRecord(value) || !isWorkerRecord(value.origin)) return false;
	return (
		typeof value.date === "string" &&
		typeof value.sequence === "number" &&
		value.origin.type === "posting" &&
		typeof value.origin.postingId === "string" &&
		isFiniteNumber(value.requestedAmount) &&
		isFiniteNumber(value.realizedAmount) &&
		Array.isArray(value.accountDeltas) &&
		value.accountDeltas.every(isAccountDelta) &&
		(value.income === undefined || isWorkerRecord(value.income))
	);
}

function isEvaluationResultEnvelope(
	value: unknown,
): value is EvaluationResultEnvelope {
	if (!isWorkerRecord(value)) return false;
	return (
		typeof value.instanceId === "string" &&
		typeof value.label === "string" &&
		(value.status === "satisfied" ||
			value.status === "not-satisfied" ||
			value.status === "warning" ||
			value.status === "indeterminate") &&
		(value.deterministic === null || isJsonValue(value.deterministic)) &&
		(value.probabilistic === null || isJsonValue(value.probabilistic)) &&
		Array.isArray(value.diagnostics) &&
		value.diagnostics.every((diagnostic) => {
			if (!isWorkerRecord(diagnostic)) return false;
			return (
				typeof diagnostic.code === "string" &&
				typeof diagnostic.message === "string" &&
				(diagnostic.severity === "info" ||
					diagnostic.severity === "warning" ||
					diagnostic.severity === "error")
			);
		})
	);
}

function isEvaluationResultCollection(
	value: unknown,
): value is EvaluationResultCollection {
	if (!isWorkerRecord(value)) return false;
	const evaluations = value.evaluations;
	if (!isWorkerRecord(evaluations)) return false;
	return EVALUATION_TYPE_ORDER.every(
		(type) =>
			Array.isArray(evaluations[type]) &&
			evaluations[type].every(isEvaluationResultEnvelope),
	);
}

function isProjectionCoreResult(value: unknown): value is ProjectionCoreResult {
	if (!isWorkerRecord(value)) return false;
	if (!isWorkerRecord(value.timeline)) return false;
	if (!Array.isArray(value.timeline.rows)) return false;
	if (!Array.isArray(value.timeline.sampledRows)) return false;
	if (!Array.isArray(value.accountSummaries)) return false;
	if (!isWorkerRecord(value.totals) || !isWorkerRecord(value.milestones)) {
		return false;
	}
	if (!isWorkerRecord(value.summary)) return false;
	return (
		value.timeline.rows.every(isProjectionRow) &&
		value.timeline.sampledRows.every(isProjectionRow) &&
		value.accountSummaries.every(isAccountSummary) &&
		isFiniteNumber(value.totals.externalInflowAmount) &&
		isFiniteNumber(value.totals.externalOutflowAmount) &&
		isFiniteNumber(value.totals.internalTransferAmount) &&
		isNullableString(value.milestones.latestHistoricalDate) &&
		typeof value.milestones.projectionStartDate === "string" &&
		isFiniteNumber(value.summary.currentNetWorth) &&
		isFiniteNumber(value.summary.finalNetWorth)
	);
}

function isFiniteNumberMap(value: unknown): value is Map<string, number> {
	if (!(value instanceof Map)) return false;
	return [...value.entries()].every(
		([key, entry]) => typeof key === "string" && isFiniteNumber(entry),
	);
}

function isFiniteNumberMapByKey(
	value: unknown,
): value is Map<string, Map<string, number>> {
	return (
		value instanceof Map &&
		[...value.entries()].every(
			([key, entry]) => typeof key === "string" && isFiniteNumberMap(entry),
		)
	);
}

function isIncomeDataSnapshot(value: unknown): value is IncomeDataSnapshot {
	if (!isWorkerRecord(value)) return false;
	if (
		!Array.isArray(value.incomeSources) ||
		!Array.isArray(value.taxProfiles)
	) {
		return false;
	}
	return (
		value.incomeSources.every(
			(source) =>
				isWorkerRecord(source) &&
				typeof source.id === "string" &&
				typeof source.label === "string" &&
				typeof source.effectiveFrom === "string" &&
				isNullableString(source.effectiveTo) &&
				isFiniteNumber(source.annualGrossIncome),
		) &&
		value.taxProfiles.every(
			(profile) =>
				isWorkerRecord(profile) &&
				typeof profile.id === "string" &&
				typeof profile.label === "string" &&
				isFiniteNumber(profile.deduction) &&
				Array.isArray(profile.brackets) &&
				profile.brackets.every(
					(bracket) =>
						isWorkerRecord(bracket) &&
						(bracket.upTo === null || isFiniteNumber(bracket.upTo)) &&
						isFiniteNumber(bracket.rate),
				) &&
				isNullableString(profile.sourceUrl),
		)
	);
}

function decodeProjectionPath(value: unknown): ProjectionPath | null {
	if (!isWorkerRecord(value)) return null;
	if (!Array.isArray(value.rows) || !Array.isArray(value.movementEvents)) {
		return null;
	}
	if (
		!value.rows.every(isProjectionRow) ||
		!value.movementEvents.every(isMovementEvent)
	) {
		return null;
	}
	const effectiveDocument = parseFinancialModelDocument(
		value.effectiveDocument,
	);
	if (!effectiveDocument) return null;
	const postingState = value.projectionStartPostingState;
	if (!isWorkerRecord(postingState)) return null;
	if (!isFiniteNumberMap(postingState.latestRealizedPostingAmounts))
		return null;
	if (!isFiniteNumberMapByKey(postingState.realizedPostingAmountsByYear))
		return null;
	if (
		value.incomeData !== undefined &&
		!isIncomeDataSnapshot(value.incomeData)
	) {
		return null;
	}
	if (
		typeof value.projectionStartDate !== "string" ||
		typeof value.projectionEndDate !== "string"
	) {
		return null;
	}
	return {
		rows: value.rows,
		movementEvents: value.movementEvents,
		projectionStartPostingState: {
			latestRealizedPostingAmounts: postingState.latestRealizedPostingAmounts,
			realizedPostingAmountsByYear: postingState.realizedPostingAmountsByYear,
		},
		effectiveDocument,
		...(value.incomeData === undefined ? {} : { incomeData: value.incomeData }),
		projectionStartDate: value.projectionStartDate,
		projectionEndDate: value.projectionEndDate,
	};
}

export function isProjectionResult(value: unknown): value is ProjectionResult {
	return isProjectionCoreResult(value) && isEvaluationResultCollection(value);
}

export function isEvaluationResultCollectionPayload(
	value: unknown,
): value is EvaluationResultCollection {
	return isEvaluationResultCollection(value);
}

function isPercentileBands(value: unknown): boolean {
	if (!isWorkerRecord(value)) return false;
	return (
		isFiniteNumber(value.p10) &&
		isFiniteNumber(value.p25) &&
		isFiniteNumber(value.p50) &&
		isFiniteNumber(value.p75) &&
		isFiniteNumber(value.p90)
	);
}

export function isStochasticProjectionResult(
	value: unknown,
): value is StochasticProjectionResult {
	if (!isWorkerRecord(value) || !isWorkerRecord(value.config)) return false;
	if (!isProjectionResult(value.deterministic)) return false;
	if (!Array.isArray(value.bands) || !isWorkerRecord(value.milestones))
		return false;
	return (
		isFiniteNumber(value.config.runCount) &&
		Number.isInteger(value.config.runCount) &&
		value.config.runCount > 0 &&
		(value.config.seed === null || isFiniteNumber(value.config.seed)) &&
		value.bands.every(
			(band) =>
				isWorkerRecord(band) &&
				typeof band.date === "string" &&
				typeof band.isHistorical === "boolean" &&
				isPercentileBands(band.netWorth),
		) &&
		isPercentileBands(value.milestones.finalNetWorthPercentiles) &&
		isEvaluationResultCollection(value)
	);
}

function isStochasticWorkload(value: unknown): boolean {
	if (!isWorkerRecord(value)) return false;
	return (
		typeof value.type === "string" &&
		EVALUATION_TYPE_ORDER.includes(
			value.type as (typeof EVALUATION_TYPE_ORDER)[number],
		) &&
		typeof value.instanceId === "string" &&
		typeof value.label === "string" &&
		isFiniteNumber(value.completedUnits) &&
		isFiniteNumber(value.totalUnits) &&
		value.completedUnits >= 0 &&
		value.totalUnits >= 0 &&
		typeof value.unitLabel === "string" &&
		typeof value.unitAction === "string" &&
		(value.intensiveUnitsCompleted === undefined ||
			(isFiniteNumber(value.intensiveUnitsCompleted) &&
				value.intensiveUnitsCompleted >= 0)) &&
		(value.intensiveUnitLabel === undefined ||
			typeof value.intensiveUnitLabel === "string") &&
		(value.intensiveUnitAction === undefined ||
			typeof value.intensiveUnitAction === "string") &&
		(value.description === undefined || typeof value.description === "string")
	);
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
		isStochasticProgress(value.progress)
	);
}

function isStochasticProgress(value: unknown): value is StochasticProgress {
	if (!isWorkerRecord(value)) return false;
	return (
		(value.phase === "preparing" ||
			value.phase === "deterministic-evaluations" ||
			value.phase === "stochastic-runs") &&
		typeof value.completedRuns === "number" &&
		typeof value.totalRuns === "number" &&
		Number.isInteger(value.completedRuns) &&
		Number.isInteger(value.totalRuns) &&
		value.completedRuns >= 0 &&
		value.totalRuns >= 0 &&
		isFiniteNumber(value.fraction) &&
		value.fraction >= 0 &&
		value.fraction <= 1 &&
		Array.isArray(value.evaluationWorkloads) &&
		value.evaluationWorkloads.every(isStochasticWorkload)
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

export function decodeProjectionResult(
	value: unknown,
): ProjectionResult | null {
	return isProjectionResult(value) ? value : null;
}

export function decodeRawProjectionOutput(
	value: unknown,
): RawProjectionOutput | null {
	if (!isWorkerRecord(value) || !isProjectionCoreResult(value.result)) {
		return null;
	}
	const path = decodeProjectionPath(value.path);
	return path ? { path, result: value.result } : null;
}

export function decodeEvaluationResultCollection(
	value: unknown,
): EvaluationResultCollection | null {
	return isEvaluationResultCollection(value) ? value : null;
}

export function decodeStochasticProjectionResult(
	value: unknown,
): StochasticProjectionResult | null {
	return isStochasticProjectionResult(value) ? value : null;
}
