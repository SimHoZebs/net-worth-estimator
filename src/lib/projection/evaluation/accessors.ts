import type {
	ConfiguredEvaluation,
	EvaluationResultCollection,
	EvaluationResultEnvelope,
	FinancialIndependenceAnalysis,
} from "../types/scenario";
import {
	FINANCIAL_INDEPENDENCE_DEFINITION_ID,
	type FinancialIndependenceProbabilisticResult,
	validateFinancialIndependencePlan,
} from "./financialIndependence";
import { isJsonValue } from "./json";
import {
	NET_WORTH_THRESHOLD_DEFINITION_ID,
	type NetWorthThresholdPathResult,
	type NetWorthThresholdProbabilisticResult,
	validateNetWorthThresholdConfig,
} from "./netWorthThreshold";
import {
	POSTING_FULFILLMENT_DEFINITION_ID,
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
	ConfiguredEvaluation,
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
	collection: EvaluationResultCollection | null | undefined,
	definitionId: string,
	instanceId?: string,
) {
	if (!collection) return null;
	const id =
		instanceId ??
		collection.evaluationOrder.find((candidate) => {
			const envelope = collection.evaluations[candidate];
			return (
				envelope?.definitionId === definitionId &&
				isSuccessfulEnvelope(envelope)
			);
		});
	if (!id) return null;
	const envelope = collection.evaluations[id];
	if (!envelope || envelope.definitionId !== definitionId) return null;
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
	>(collection, FINANCIAL_INDEPENDENCE_DEFINITION_ID, instanceId);
}

export function getNetWorthThresholdResult(
	collection: EvaluationResultCollection | null | undefined,
	instanceId?: string,
) {
	return getEnvelope<
		NetWorthThresholdPathResult,
		NetWorthThresholdProbabilisticResult
	>(collection, NET_WORTH_THRESHOLD_DEFINITION_ID, instanceId);
}

export function getPostingFulfillmentResult(
	collection: EvaluationResultCollection | null | undefined,
	instanceId?: string,
) {
	return getEnvelope<
		PostingFulfillmentPathResult,
		PostingFulfillmentProbabilisticResult
	>(collection, POSTING_FULFILLMENT_DEFINITION_ID, instanceId);
}

export function getConfiguredEvaluation<TConfig>(
	evaluations: readonly ConfiguredEvaluation[],
	definitionId: string,
	validate: (config: unknown) => TConfig,
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
): ValidatedConfiguredEvaluation<TConfig> | null {
	const candidates = instanceId
		? evaluations.filter((item) => item.instanceId === instanceId)
		: evaluations;
	for (const evaluation of candidates) {
		if (evaluation.definitionId !== definitionId) continue;
		if (instanceId === undefined && !evaluation.enabled) continue;
		if (
			instanceId === undefined &&
			collection &&
			!isSuccessfulEnvelope(collection.evaluations[evaluation.instanceId])
		) {
			continue;
		}
		try {
			const config = validate(evaluation.config);
			if (!isJsonValue(config)) continue;
			return { ...evaluation, config };
		} catch {}
	}
	return null;
}

export function getFinancialIndependenceConfig(
	evaluations: readonly ConfiguredEvaluation[],
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations,
		FINANCIAL_INDEPENDENCE_DEFINITION_ID,
		validateFinancialIndependencePlan,
		collection,
		instanceId,
	);
}

export function getNetWorthThresholdConfig(
	evaluations: readonly ConfiguredEvaluation[],
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations,
		NET_WORTH_THRESHOLD_DEFINITION_ID,
		validateNetWorthThresholdConfig,
		collection,
		instanceId,
	);
}

export function getPostingFulfillmentConfig(
	evaluations: readonly ConfiguredEvaluation[],
	collection?: EvaluationResultCollection | null,
	instanceId?: string,
) {
	return getConfiguredEvaluation(
		evaluations,
		POSTING_FULFILLMENT_DEFINITION_ID,
		validatePostingFulfillmentConfig,
		collection,
		instanceId,
	);
}
