import type {
	AccountMovementConstraint,
	EvaluationDiagnostic,
	IsoDate,
	MovementEvent,
	PostingFulfillmentConfig,
	ProjectionPath,
} from "../types/model";
import type { PercentileBands } from "../types/stochastic";
import { computePercentiles } from "../utils/stochastic";
import {
	classifyMovementConstraints,
	reconstructBalancesBeforeEvents,
} from "./movementConstraints";
import type { EvaluationDefinition } from "./runtime";

export const POSTING_FULFILLMENT_DEFINITION_ID = "posting-fulfillment";
export const DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID = "posting-fulfillment";
const MIN_REPORTABLE_UNFULFILLED_AMOUNT = 0.5;

export interface PostingFulfillmentEvent {
	date: IsoDate;
	sequence: number;
	postingId: string;
	requestedAmount: number;
	realizedAmount: number;
	destinationLimitedAmount: number;
	unfulfilledAmount: number;
	bindingConstraints: AccountMovementConstraint[];
	accountDeltas: Array<{ accountId: string; delta: number }>;
}

export interface PostingFulfillmentDateSummary {
	date: IsoDate;
	requestedAmount: number;
	realizedAmount: number;
	destinationLimitedAmount: number;
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
	destinationLimitedAmount: number;
	utilizationRate: number;
	completionRate: number;
	firstUnderfulfilledDate: IsoDate | null;
	unfulfilledAmount: number;
}

export interface PostingFulfillmentPathResult {
	requestedAmount: number;
	realizedAmount: number;
	destinationLimitedAmount: number;
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

function reportableUnfulfilledAmount(event: MovementEvent) {
	const amount = Math.max(0, event.requestedAmount - event.realizedAmount);
	return amount >= MIN_REPORTABLE_UNFULFILLED_AMOUNT ? amount : 0;
}

function reportedAmounts(
	requestedAmount: number,
	realizedAmount: number,
	destinationLimitedAmount: number,
	unfulfilledAmount: number,
) {
	return {
		requestedAmount: roundAmount(requestedAmount),
		realizedAmount: roundAmount(realizedAmount),
		destinationLimitedAmount: roundAmount(destinationLimitedAmount),
		unfulfilledAmount: roundAmount(unfulfilledAmount),
	};
}

interface EvaluatedMovementEvent {
	event: MovementEvent;
	bindingConstraints: AccountMovementConstraint[];
	destinationLimitedAmount: number;
	unfulfilledAmount: number;
}

function toFulfillmentEvent({
	event,
	bindingConstraints,
	destinationLimitedAmount,
	unfulfilledAmount,
}: EvaluatedMovementEvent): PostingFulfillmentEvent {
	const amounts = reportedAmounts(
		event.requestedAmount,
		event.realizedAmount,
		destinationLimitedAmount,
		unfulfilledAmount,
	);
	return {
		date: event.date,
		sequence: event.sequence,
		postingId: event.origin.postingId,
		...amounts,
		bindingConstraints,
		accountDeltas: event.accountDeltas.map(({ accountId, delta }) => ({
			accountId,
			delta: roundAmount(delta),
		})),
	};
}

function evaluateMovementEvents(
	path: ProjectionPath,
): EvaluatedMovementEvent[] {
	const balancesBeforeBySequence = reconstructBalancesBeforeEvents(path);
	const accountsById = new Map(
		path.effectiveDocument.accounts.map((account) => [account.id, account]),
	);
	const postingsById = new Map(
		path.effectiveDocument.postings.map((posting) => [posting.id, posting]),
	);
	const realizedByPostingAndYear = new Map<string, number>();

	return [...path.movementEvents]
		.sort(
			(left, right) =>
				left.date.localeCompare(right.date) || left.sequence - right.sequence,
		)
		.map((event) => {
			const posting = postingsById.get(event.origin.postingId);
			const capKey = `${event.origin.postingId}:${event.date.slice(0, 4)}`;
			const realizedBefore = realizedByPostingAndYear.get(capKey) ?? 0;
			const limitRemaining =
				posting?.annualCap === null || posting?.annualCap === undefined
					? undefined
					: Math.max(0, posting.annualCap - realizedBefore);
			const bindingConstraints = posting
				? classifyMovementConstraints({
						sourceAccountId: posting.sourceAccountId,
						destinations: posting.destinations,
						requestedAmount: event.requestedAmount,
						realizedAmount: event.realizedAmount,
						balancesBefore: balancesBeforeBySequence.get(event.sequence) ?? {},
						accountsById,
						limitRemaining,
					})
				: [];
			const reportableResidual = reportableUnfulfilledAmount(event);
			const destinationLimited = bindingConstraints.some(
				(constraint) => constraint.type === "destination-ceiling",
			);
			realizedByPostingAndYear.set(
				capKey,
				realizedBefore + event.realizedAmount,
			);
			return {
				event,
				bindingConstraints,
				destinationLimitedAmount: destinationLimited ? reportableResidual : 0,
				unfulfilledAmount: destinationLimited ? 0 : reportableResidual,
			};
		});
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
	options: { includeDetails?: boolean } = {},
): PostingFulfillmentPathResult {
	const includeDetails = options.includeDetails ?? true;
	const selectedIds = config.postingIds ? new Set(config.postingIds) : null;
	const evaluatedEvents = evaluateMovementEvents(path);
	const events: PostingFulfillmentEvent[] = [];
	const totalsByPostingId = new Map<
		string,
		{
			requestedAmount: number;
			realizedAmount: number;
			destinationLimitedAmount: number;
			unfulfilledAmount: number;
			firstUnderfulfilledDate: IsoDate | null;
		}
	>();
	const totalsByDate = new Map<
		IsoDate,
		{
			requestedAmount: number;
			realizedAmount: number;
			destinationLimitedAmount: number;
			unfulfilledAmount: number;
		}
	>();
	let requestedAmount = 0;
	let realizedAmount = 0;
	let destinationLimitedAmount = 0;
	let unfulfilledAmount = 0;
	let firstUnderfulfilledDate: IsoDate | null = null;

	for (const evaluatedEvent of evaluatedEvents) {
		const { event } = evaluatedEvent;
		if (selectedIds !== null && !selectedIds.has(event.origin.postingId)) {
			continue;
		}
		const eventUnfulfilledAmount = evaluatedEvent.unfulfilledAmount;
		requestedAmount += event.requestedAmount;
		realizedAmount += event.realizedAmount;
		destinationLimitedAmount += evaluatedEvent.destinationLimitedAmount;
		unfulfilledAmount += eventUnfulfilledAmount;
		if (firstUnderfulfilledDate === null && eventUnfulfilledAmount > 0) {
			firstUnderfulfilledDate = event.date;
		}
		if (!includeDetails) continue;
		events.push(toFulfillmentEvent(evaluatedEvent));
		const postingId = event.origin.postingId;
		const postingTotals = totalsByPostingId.get(postingId) ?? {
			requestedAmount: 0,
			realizedAmount: 0,
			destinationLimitedAmount: 0,
			unfulfilledAmount: 0,
			firstUnderfulfilledDate: null,
		};
		postingTotals.requestedAmount += event.requestedAmount;
		postingTotals.realizedAmount += event.realizedAmount;
		postingTotals.destinationLimitedAmount +=
			evaluatedEvent.destinationLimitedAmount;
		postingTotals.unfulfilledAmount += eventUnfulfilledAmount;
		if (
			postingTotals.firstUnderfulfilledDate === null &&
			eventUnfulfilledAmount > 0
		) {
			postingTotals.firstUnderfulfilledDate = event.date;
		}
		totalsByPostingId.set(postingId, postingTotals);

		const dateTotals = totalsByDate.get(event.date) ?? {
			requestedAmount: 0,
			realizedAmount: 0,
			destinationLimitedAmount: 0,
			unfulfilledAmount: 0,
		};
		dateTotals.requestedAmount += event.requestedAmount;
		dateTotals.realizedAmount += event.realizedAmount;
		dateTotals.destinationLimitedAmount +=
			evaluatedEvent.destinationLimitedAmount;
		dateTotals.unfulfilledAmount += eventUnfulfilledAmount;
		totalsByDate.set(event.date, dateTotals);
	}

	const accountById = includeDetails
		? new Map(
				path.effectiveDocument.accounts.map((account) => [account.id, account]),
			)
		: new Map();
	const postings = (includeDetails ? path.effectiveDocument.postings : [])
		.filter((posting) => selectedIds === null || selectedIds.has(posting.id))
		.map((posting): PostingFulfillmentPostingSummary => {
			const totals = totalsByPostingId.get(posting.id) ?? {
				requestedAmount: 0,
				realizedAmount: 0,
				destinationLimitedAmount: 0,
				unfulfilledAmount: 0,
				firstUnderfulfilledDate: null,
			};
			const amounts = reportedAmounts(
				totals.requestedAmount,
				totals.realizedAmount,
				totals.destinationLimitedAmount,
				totals.unfulfilledAmount,
			);
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
				requestedAmount: amounts.requestedAmount,
				realizedAmount: amounts.realizedAmount,
				destinationLimitedAmount: amounts.destinationLimitedAmount,
				utilizationRate:
					totals.requestedAmount > 0
						? totals.realizedAmount / totals.requestedAmount
						: 0,
				completionRate:
					totals.requestedAmount > 0
						? Math.max(0, 1 - totals.unfulfilledAmount / totals.requestedAmount)
						: 1,
				firstUnderfulfilledDate: totals.firstUnderfulfilledDate,
				unfulfilledAmount: amounts.unfulfilledAmount,
			};
		});
	const dates = [...totalsByDate.entries()]
		.map(([date, totals]): PostingFulfillmentDateSummary => {
			const amounts = reportedAmounts(
				totals.requestedAmount,
				totals.realizedAmount,
				totals.destinationLimitedAmount,
				totals.unfulfilledAmount,
			);
			return { date, ...amounts };
		})
		.sort((left, right) => left.date.localeCompare(right.date));
	const amounts = reportedAmounts(
		requestedAmount,
		realizedAmount,
		destinationLimitedAmount,
		unfulfilledAmount,
	);
	return {
		...amounts,
		completionRate:
			requestedAmount > 0
				? Math.max(0, 1 - unfulfilledAmount / requestedAmount)
				: 1,
		firstUnderfulfilledDate,
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
	const postingIds = new Set(
		path.effectiveDocument.postings.map(({ id }) => id),
	);
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
	type: "postingFulfillment",
	label: "Posting fulfillment",
	validateConfig: validatePostingFulfillmentConfig,
	evaluatePath({ path, detailLevel }, config) {
		return evaluatePostingFulfillment(path, config, {
			includeDetails: detailLevel !== "summary",
		});
	},
	diagnoseConfig({ path }, config) {
		return diagnoseConfig(path, config);
	},
	createAccumulator() {
		return { runCount: 0, fulfilledRunCount: 0, unfulfilledAmounts: [] };
	},
	accumulate(accumulator, pathResult) {
		accumulator.runCount++;
		if (pathResult.firstUnderfulfilledDate === null) {
			accumulator.fulfilledRunCount++;
		}
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
			: deterministic?.firstUnderfulfilledDate === null
				? "satisfied"
				: "not-satisfied";
	},
};
