import type {
	AccountMovementConstraint,
	EvaluationDiagnostic,
	IsoDate,
	MovementEvent,
	ProjectionPath,
} from "../types/scenario";
import type { PercentileBands } from "../types/stochastic";
import { computePercentiles } from "../utils/stochastic";
import type { EvaluationDefinition } from "./runtime";

export const POSTING_FULFILLMENT_DEFINITION_ID = "posting-fulfillment";

export interface PostingFulfillmentConfig {
	postingIds: string[] | null;
}

export interface PostingFulfillmentEvent {
	date: IsoDate;
	sequence: number;
	postingId: string;
	requestedAmount: number;
	realizedAmount: number;
	unfulfilledAmount: number;
	bindingConstraints: AccountMovementConstraint[];
	accountDeltas: Array<{ accountId: string; delta: number }>;
}

export interface PostingFulfillmentDateSummary {
	date: IsoDate;
	requestedAmount: number;
	realizedAmount: number;
	unfulfilledAmount: number;
}

export interface PostingFulfillmentPostingSummary {
	postingId: string;
	label: string;
	sourceAccountId: string | null;
	sourceAccountLabel: string | null;
	destinations: Array<{ accountId: string; label: string }> | null;
	priority: number;
	annualCap: number | null;
	requestedAmount: number;
	realizedAmount: number;
	utilizationRate: number;
	firstUnderfulfilledDate: IsoDate | null;
	unfulfilledAmount: number;
}

export interface PostingFulfillmentPathResult {
	requestedAmount: number;
	realizedAmount: number;
	unfulfilledAmount: number;
	completionRate: number;
	firstUnderfulfilledDate: IsoDate | null;
	events: PostingFulfillmentEvent[];
	dates: PostingFulfillmentDateSummary[];
	postings: PostingFulfillmentPostingSummary[];
}

export interface PostingFulfillmentProbabilisticResult {
	runCount: number;
	fulfilledRunCount: number;
	fullFulfillmentProbability: number;
	unfulfilledAmountPercentiles: PercentileBands;
}

interface PostingFulfillmentAccumulator {
	runCount: number;
	fulfilledRunCount: number;
	unfulfilledAmounts: number[];
}

function roundAmount(value: number) {
	return Math.round(value);
}

function toFulfillmentEvent(event: MovementEvent): PostingFulfillmentEvent {
	return {
		date: event.date,
		sequence: event.sequence,
		postingId: event.origin.postingId,
		requestedAmount: roundAmount(event.requestedAmount),
		realizedAmount: roundAmount(event.realizedAmount),
		unfulfilledAmount: roundAmount(
			Math.max(0, event.requestedAmount - event.realizedAmount),
		),
		bindingConstraints: event.bindingConstraints,
		accountDeltas: event.accountDeltas.map(({ accountId, delta }) => ({
			accountId,
			delta: roundAmount(delta),
		})),
	};
}

export function validatePostingFulfillmentConfig(
	config: unknown,
): PostingFulfillmentConfig {
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error("Posting fulfillment configuration must be an object.");
	}
	const postingIds = "postingIds" in config ? config.postingIds : null;
	if (postingIds === null) return { postingIds: null };
	if (
		!Array.isArray(postingIds) ||
		postingIds.some((postingId) =>
			Boolean(typeof postingId !== "string" || postingId.trim() === ""),
		)
	) {
		throw new Error(
			"Posting fulfillment postingIds must be null or an array of IDs.",
		);
	}
	return { postingIds: [...new Set(postingIds)] };
}

export function evaluatePostingFulfillment(
	path: ProjectionPath,
	config: PostingFulfillmentConfig,
): PostingFulfillmentPathResult {
	const selectedIds = config.postingIds ? new Set(config.postingIds) : null;
	const rawEvents = path.movementEvents.filter(
		(event) => selectedIds === null || selectedIds.has(event.origin.postingId),
	);
	const events = rawEvents.map(toFulfillmentEvent);
	const accountById = new Map(
		path.effectivePack.accounts.map((account) => [account.id, account]),
	);
	const totalsByPostingId = new Map<
		string,
		{
			requestedAmount: number;
			realizedAmount: number;
			firstUnderfulfilledDate: IsoDate | null;
		}
	>();
	const totalsByDate = new Map<
		IsoDate,
		{ requestedAmount: number; realizedAmount: number }
	>();
	let requestedAmount = 0;
	let realizedAmount = 0;

	for (const event of rawEvents) {
		requestedAmount += event.requestedAmount;
		realizedAmount += event.realizedAmount;
		const postingId = event.origin.postingId;
		const postingTotals = totalsByPostingId.get(postingId) ?? {
			requestedAmount: 0,
			realizedAmount: 0,
			firstUnderfulfilledDate: null,
		};
		postingTotals.requestedAmount += event.requestedAmount;
		postingTotals.realizedAmount += event.realizedAmount;
		if (
			postingTotals.firstUnderfulfilledDate === null &&
			event.requestedAmount > event.realizedAmount
		) {
			postingTotals.firstUnderfulfilledDate = event.date;
		}
		totalsByPostingId.set(postingId, postingTotals);

		const dateTotals = totalsByDate.get(event.date) ?? {
			requestedAmount: 0,
			realizedAmount: 0,
		};
		dateTotals.requestedAmount += event.requestedAmount;
		dateTotals.realizedAmount += event.realizedAmount;
		totalsByDate.set(event.date, dateTotals);
	}

	const postings = path.effectivePack.postings
		.filter((posting) => selectedIds === null || selectedIds.has(posting.id))
		.map((posting): PostingFulfillmentPostingSummary => {
			const totals = totalsByPostingId.get(posting.id) ?? {
				requestedAmount: 0,
				realizedAmount: 0,
				firstUnderfulfilledDate: null,
			};
			return {
				postingId: posting.id,
				label: posting.label,
				sourceAccountId: posting.sourceAccountId,
				sourceAccountLabel: posting.sourceAccountId
					? (accountById.get(posting.sourceAccountId)?.label ??
						posting.sourceAccountId)
					: null,
				destinations: posting.destinations
					? posting.destinations.map((accountId) => ({
							accountId,
							label: accountById.get(accountId)?.label ?? accountId,
						}))
					: null,
				priority: posting.priority,
				annualCap: posting.annualCap,
				requestedAmount: roundAmount(totals.requestedAmount),
				realizedAmount: roundAmount(totals.realizedAmount),
				utilizationRate:
					totals.requestedAmount > 0
						? totals.realizedAmount / totals.requestedAmount
						: 0,
				firstUnderfulfilledDate: totals.firstUnderfulfilledDate,
				unfulfilledAmount: roundAmount(
					Math.max(0, totals.requestedAmount - totals.realizedAmount),
				),
			};
		});
	const dates = [...totalsByDate.entries()]
		.map(
			([date, totals]): PostingFulfillmentDateSummary => ({
				date,
				requestedAmount: roundAmount(totals.requestedAmount),
				realizedAmount: roundAmount(totals.realizedAmount),
				unfulfilledAmount: roundAmount(
					Math.max(0, totals.requestedAmount - totals.realizedAmount),
				),
			}),
		)
		.sort((left, right) => left.date.localeCompare(right.date));
	const unfulfilledAmount = Math.max(0, requestedAmount - realizedAmount);

	return {
		requestedAmount: roundAmount(requestedAmount),
		realizedAmount: roundAmount(realizedAmount),
		unfulfilledAmount: roundAmount(unfulfilledAmount),
		completionRate: requestedAmount > 0 ? realizedAmount / requestedAmount : 1,
		firstUnderfulfilledDate:
			events.find((event) => event.unfulfilledAmount > 0)?.date ?? null,
		events,
		dates,
		postings,
	};
}

function diagnoseConfig(
	path: ProjectionPath,
	config: PostingFulfillmentConfig,
): EvaluationDiagnostic[] {
	if (config.postingIds === null) return [];
	const postingIds = new Set(path.effectivePack.postings.map(({ id }) => id));
	return config.postingIds
		.filter((postingId) => !postingIds.has(postingId))
		.map((postingId) => ({
			code: "posting-fulfillment.posting.missing",
			severity: "warning" as const,
			message: `Posting '${postingId}' does not exist.`,
			relatedPostingIds: [postingId],
		}));
}

export const postingFulfillmentEvaluation: EvaluationDefinition<
	PostingFulfillmentConfig,
	PostingFulfillmentPathResult,
	PostingFulfillmentAccumulator,
	PostingFulfillmentProbabilisticResult
> = {
	id: POSTING_FULFILLMENT_DEFINITION_ID,
	label: "Posting fulfillment",
	validateConfig: validatePostingFulfillmentConfig,
	evaluatePath({ path }, config) {
		return evaluatePostingFulfillment(path, config);
	},
	diagnoseConfig({ path }, config) {
		return diagnoseConfig(path, config);
	},
	createAccumulator() {
		return { runCount: 0, fulfilledRunCount: 0, unfulfilledAmounts: [] };
	},
	accumulate(accumulator, pathResult) {
		accumulator.runCount++;
		if (pathResult.unfulfilledAmount === 0) accumulator.fulfilledRunCount++;
		accumulator.unfulfilledAmounts.push(pathResult.unfulfilledAmount);
	},
	finalize(accumulator) {
		return {
			runCount: accumulator.runCount,
			fulfilledRunCount: accumulator.fulfilledRunCount,
			fullFulfillmentProbability:
				accumulator.runCount > 0
					? accumulator.fulfilledRunCount / accumulator.runCount
					: 0,
			unfulfilledAmountPercentiles: computePercentiles(
				accumulator.unfulfilledAmounts,
			),
		};
	},
	status(deterministic, probabilistic) {
		return probabilistic
			? probabilistic.fullFulfillmentProbability === 1
				? "satisfied"
				: "not-satisfied"
			: deterministic?.unfulfilledAmount === 0
				? "satisfied"
				: "not-satisfied";
	},
};
