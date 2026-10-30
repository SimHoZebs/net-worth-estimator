import { money, percent } from "../domain/format.ts";
import {
	fundingEvaluationName,
	fundingLabels,
} from "../domain/fundingTerminology.ts";
import { finite, isRecord, stringValue } from "../domain/guards.ts";
import type {
	EvaluationResult,
	OtherEvaluation,
	OtherEvaluationBands,
	OtherEvaluationProgress,
	OtherEvaluationValue,
} from "../domain/result.ts";
import type {
	EvaluationResultEnvelope,
	JsonValue,
	ProjectionAccountSummary,
} from "./contracts.ts";
import { financialIndependenceEvaluation } from "./financialIndependence.ts";

export function valueRecord(
	value: JsonValue | undefined,
): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function evaluationDate(
	envelope: EvaluationResultEnvelope | undefined,
): string | null {
	const deterministic = valueRecord(envelope?.deterministic);
	return stringValue(deterministic?.firstReachedDate);
}

// Both threshold-shaped evaluations (net worth threshold, account balance)
// share this instance shape, so one mapper serves each kind.
export type EditableEvaluation = {
	instanceId: string;
	name: string;
	enabled: boolean;
	config: JsonValue;
};

// An evaluation whose envelope is missing is named indeterminate rather than
// reported as unmet, so an unevaluated evaluation is never shown as a failure.
export function evaluatedEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
) {
	const represented =
		envelope?.status === "satisfied" || envelope?.status === "not-satisfied";
	const name = evaluation.name || evaluation.instanceId;
	return {
		name: represented ? name : `${name} (indeterminate)`,
		firstDate: represented ? evaluationDate(envelope) : null,
	};
}

export function thresholdEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	current: number,
	final: number,
): EvaluationResult {
	const config = valueRecord(evaluation.config);
	const { name, firstDate } = evaluatedEvaluation(evaluation, envelope);
	return {
		evaluation: {
			id: evaluation.instanceId,
			name,
			kind: "net-worth" as const,
			target: finite(config?.target) ?? 0,
			accountId: null,
			enabled: evaluation.enabled,
		},
		firstDate,
		current,
		final,
	};
}

export function balanceEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	balances: Map<string, ProjectionAccountSummary>,
): EvaluationResult {
	const config = valueRecord(evaluation.config);
	const accountId =
		typeof config?.accountId === "string" ? config.accountId : null;
	const { name, firstDate } = evaluatedEvaluation(evaluation, envelope);
	const summary = accountId === null ? undefined : balances.get(accountId);
	return {
		evaluation: {
			id: evaluation.instanceId,
			name,
			kind: "reserve" as const,
			target: finite(config?.target) ?? 0,
			accountId,
			enabled: evaluation.enabled,
		},
		firstDate,
		current: summary?.startingBalance ?? 0,
		final: summary?.endingBalance ?? 0,
	};
}

export interface OtherOutcome {
	goal: string | null;
	outcomeDate: string | null;
	outcomeText: string;
	qualifier: string | null;
	progress: OtherEvaluationProgress | null;
}

export function postingOutcome(
	deterministic: Record<string, unknown> | null,
): OtherOutcome {
	const fulfilled: OtherOutcome = {
		goal: null,
		outcomeDate: null,
		outcomeText: fundingLabels.clear,
		qualifier: null,
		progress: null,
	};
	if (!deterministic) return fulfilled;
	const firstDate = stringValue(deterministic.firstUnderfulfilledDate);
	if (!firstDate) return fulfilled;
	const completion = finite(deterministic.completionRate);
	return {
		...fulfilled,
		outcomeDate: firstDate,
		outcomeText: "Shortfall",
		progress:
			completion !== null && completion >= 0
				? { fraction: completion, current: percent(completion), share: null }
				: null,
	};
}

export function cycleOutcome(
	deterministic: Record<string, unknown> | null,
): OtherOutcome {
	const within = deterministic?.withinBudget === true;
	const base: OtherOutcome = {
		goal: null,
		outcomeDate: null,
		outcomeText: within ? "Within budget" : "Over budget",
		qualifier: null,
		progress: null,
	};
	const spent = finite(deterministic?.spent);
	const budget = finite(deterministic?.budget);
	if (spent === null || budget === null || budget <= 0) return base;
	const fraction = Math.max(0, spent / budget);
	return {
		...base,
		progress: {
			fraction,
			current: money(spent),
			share: `${Math.round(fraction * 100)}%`,
		},
	};
}

/**
 * Generic numeric result carried alongside the status badge. Envelopes that
 * report a numeric `value` in their deterministic payload surface it here;
 * optional `unit` ("currency" | "ratio" | "count") labels it. Unknown shapes
 * stay null so status rendering never changes.
 */
export function numericValueOf(
	envelope: EvaluationResultEnvelope | undefined,
): OtherEvaluationValue | null {
	const deterministic = valueRecord(envelope?.deterministic);
	if (!deterministic) return null;
	const current = finite(deterministic.value);
	if (current === null) return null;
	const unit =
		deterministic.unit === "currency" ||
		deterministic.unit === "ratio" ||
		deterministic.unit === "count"
			? deterministic.unit
			: null;
	return { current, unit };
}

/**
 * Generic percentile bands carried alongside the numeric result. Reads
 * either a nested `bands` record or top-level p10/p50/p90 probabilistic
 * fields; anything else stays null.
 */
export function bandsOf(
	envelope: EvaluationResultEnvelope | undefined,
): OtherEvaluationBands | null {
	const probabilistic = valueRecord(envelope?.probabilistic);
	if (!probabilistic) return null;
	const nested = valueRecord(probabilistic.bands as JsonValue | undefined);
	const source = nested ?? probabilistic;
	const p10 = finite(source.p10);
	const p50 = finite(source.p50);
	const p90 = finite(source.p90);
	if (p10 === null && p50 === null && p90 === null) return null;
	return { p10, p50, p90 };
}

function withEnvelopeExtras(
	outcome: OtherEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
): OtherEvaluation {
	return {
		...outcome,
		value: numericValueOf(envelope),
		bands: bandsOf(envelope),
	};
}

export interface OtherEvalContext {
	envelope: EvaluationResultEnvelope | undefined;
	postingIds: string[] | null;
	enabled: boolean;
}

/**
 * Data-layer renderer registry: one mapper per server evaluation type.
 * Pure readers over the cached base path plus the evaluation envelope, so
 * eval displays resolve without a dedicated server round-trip: a missing
 * envelope renders indeterminate values instead of fetching. Output matches
 * the bespoke mappers this registry replaces.
 */
export const OTHER_EVAL_OUTCOME_RENDERERS = {
	financialIndependence: (
		evaluation: EditableEvaluation,
		context: OtherEvalContext & {
			model: Parameters<typeof financialIndependenceEvaluation>[2];
			projectionStartDate: string;
			horizonEndDate: string | null;
		},
	): OtherEvaluation =>
		withEnvelopeExtras(
			financialIndependenceEvaluation(
				evaluation,
				context.envelope,
				context.model,
				context.projectionStartDate,
				context.horizonEndDate,
			),
			context.envelope,
		),
	postingFulfillment: (
		evaluation: EditableEvaluation,
		context: OtherEvalContext,
	): OtherEvaluation =>
		withEnvelopeExtras(
			{
				id: evaluation.instanceId,
				name: fundingEvaluationName(evaluation.name),
				type: "postingFulfillment" as const,
				postingIds: context.postingIds,
				enabled: evaluation.enabled,
				status: context.envelope?.status ?? "indeterminate",
				...postingOutcome(valueRecord(context.envelope?.deterministic)),
			},
			context.envelope,
		),
	cycleFulfillment: (
		evaluation: EditableEvaluation,
		context: OtherEvalContext,
	): OtherEvaluation =>
		withEnvelopeExtras(
			{
				id: evaluation.instanceId,
				name: evaluation.name || evaluation.instanceId,
				type: "cycleFulfillment" as const,
				enabled: evaluation.enabled,
				status: context.envelope?.status ?? "indeterminate",
				...cycleOutcome(valueRecord(context.envelope?.deterministic)),
			},
			context.envelope,
		),
} as const;

export type OtherEvalRendererType = keyof typeof OTHER_EVAL_OUTCOME_RENDERERS;
