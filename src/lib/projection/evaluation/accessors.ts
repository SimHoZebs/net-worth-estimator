import type {
	EvaluationInstance,
	EvaluationResultCollection,
	EvaluationResultEnvelope,
	EvaluationTables,
	FinancialIndependenceAnalysis,
} from "../types/model";
import {
	type FinancialIndependenceProbabilisticResult,
	validateFinancialIndependencePlan,
} from "./financialIndependence";
import { isJsonValue } from "./json";
import {
	type NetWorthThresholdPathResult,
	type NetWorthThresholdProbabilisticResult,
	validateNetWorthThresholdConfig,
} from "./netWorthThreshold";
import {
	type PostingFulfillmentPathResult,
	type PostingFulfillmentProbabilisticResult,
	validatePostingFulfillmentConfig,
} from "./postingFulfillment";

type TypedEvaluationResultEnvelope<TDeterministic, TProbabilistic> = Omit<
	EvaluationResultEnvelope,
	"deterministic" | "probabilistic"
> & {
	deterministic: TDeterministic | null;
	probabilistic: TProbabilistic | null;
};

export type ValidatedConfiguredEvaluation<TConfig> = Omit<
	EvaluationInstance<unknown>,
	"config"
> & { config: TConfig };

function isSuccessfulEnvelope(envelope: EvaluationResultEnvelope | undefined) {
	return (
		(envelope?.status === "satisfied" ||
			envelope?.status === "not-satisfied") &&
		envelope.deterministic !== null
	);
}

function getEnvelope<TDeterministic, TProbabilistic>(
	evaluations: readonly EvaluationResultEnvelope[] | null | undefined,
	instanceId?: string,
) {
	if (!evaluations) return null;
	const envelope = instanceId
		? evaluations.find((candidate) => candidate.instanceId === instanceId)
		: evaluations.find(isSuccessfulEnvelope);
	if (!envelope) return null;
	const typed = envelope as unknown as TypedEvaluationResultEnvelope<
		TDeterministic,
		TProbabilistic
	>;
	return isSuccessfulEnvelope(envelope)
		? typed
		: { ...typed, probabilistic: null };
}

export function getFinancialIndependenceResult(
	collection: EvaluationResultCollection | null | undefined,
	instanceId?: string,
) {
	return getEnvelope<
		FinancialIndependenceAnalysis,
		FinancialIndependenceProbabilisticResult
	>(collection?.evaluations.financialIndependence, instanceId);
}

export function getNetWorthThresholdResult(
	collection: EvaluationResultCollection | null | undefined,
	instanceId?: string,
) {
	return getEnvelope<
		NetWorthThresholdPathResult,
		NetWorthThresholdProbabilisticResult
	>(collection?.evaluations.netWorthThreshold, instanceId);
}

export function getPostingFulfillmentResult(
	collection: EvaluationResultCollection | null | undefined,
	instanceId?: string,
) {
	return getEnvelope<
		PostingFulfillmentPathResult,
		PostingFulfillmentProbabilisticResult
	>(collection?.evaluations.postingFulfillment, instanceId);
}

export function getConfiguredEvaluation<TConfig>(
	evaluations: readonly EvaluationInstance<TConfig>[],
	validate: (config: unknown) => TConfig,
	results?: readonly EvaluationResultEnvelope[] | null,
	instanceId?: string,
): ValidatedConfiguredEvaluation<TConfig> | null {
	const candidates = instanceId
		? evaluations.filter((item) => item.instanceId === instanceId)
		: evaluations;
	for (const evaluation of candidates) {
		if (instanceId === undefined && !evaluation.enabled) continue;
		if (
			instanceId === undefined &&
			results &&
			!isSuccessfulEnvelope(
				results.find((result) => result.instanceId === evaluation.instanceId),
			)
		) {
			continue;
		}
		try {
			const config = validate(evaluation.config);
			if (!isJsonValue(config)) continue;
			return { ...evaluation, config };
		} catch {
			// Intentional probe: an invalid candidate config falls through to the
			// next result collection instead of failing the whole lookup.
		}
	}
	return null;
}

export function getFinancialIndependenceConfig(
	evaluations: EvaluationTables,
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations.financialIndependence,
		validateFinancialIndependencePlan,
		collection?.evaluations.financialIndependence,
		instanceId,
	);
}

export function getNetWorthThresholdConfig(
	evaluations: EvaluationTables,
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations.netWorthThreshold,
		validateNetWorthThresholdConfig,
		collection?.evaluations.netWorthThreshold,
		instanceId,
	);
}

export function getPostingFulfillmentConfig(
	evaluations: EvaluationTables,
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations.postingFulfillment,
		validatePostingFulfillmentConfig,
		collection?.evaluations.postingFulfillment,
		instanceId,
	);
}
