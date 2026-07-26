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

function reportableUnfulfilledAmount(event: MovementEvent) {
	const amount = Math.max(0, event.requestedAmount - event.realizedAmount);
	return amount >= MIN_REPORTABLE_UNFULFILLED_AMOUNT ? amount : 0;
}

function reportedAmounts(requestedAmount: number, unfulfilledAmount: number) {
	const requested = roundAmount(requestedAmount);
	const unfulfilled = roundAmount(unfulfilledAmount);
	return {
		requestedAmount: requested,
		realizedAmount: Math.max(0, requested - unfulfilled),
		unfulfilledAmount: unfulfilled,
	};
}

function toFulfillmentEvent(event: MovementEvent): PostingFulfillmentEvent {
	const amounts = reportedAmounts(
		event.requestedAmount,
		reportableUnfulfilledAmount(event),
	);
	return {
		date: event.date,
		sequence: event.sequence,
		postingId: event.origin.postingId,
		...amounts,
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
	options: { includeDetails?: boolean } = {},
): PostingFulfillmentPathResult {
	const includeDetails = options.includeDetails ?? true;
	const selectedIds = config.postingIds ? new Set(config.postingIds) : null;
	const events: PostingFulfillmentEvent[] = [];
	const totalsByPostingId = new Map<
		string,
		{
			requestedAmount: number;
			unfulfilledAmount: number;
			firstUnderfulfilledDate: IsoDate | null;
		}
	>();
	const totalsByDate = new Map<
		IsoDate,
		{
			requestedAmount: number;
			unfulfilledAmount: number;
		}
	>();
	let requestedAmount = 0;
	let unfulfilledAmount = 0;
	let firstUnderfulfilledDate: IsoDate | null = null;

	for (const event of path.movementEvents) {
		if (selectedIds !== null && !selectedIds.has(event.origin.postingId)) {
			continue;
		}
		const eventUnfulfilledAmount = reportableUnfulfilledAmount(event);
		requestedAmount += event.requestedAmount;
		unfulfilledAmount += eventUnfulfilledAmount;
		if (firstUnderfulfilledDate === null && eventUnfulfilledAmount > 0) {
			firstUnderfulfilledDate = event.date;
		}
		if (!includeDetails) continue;
		events.push(toFulfillmentEvent(event));
		const postingId = event.origin.postingId;
		const postingTotals = totalsByPostingId.get(postingId) ?? {
			requestedAmount: 0,
			unfulfilledAmount: 0,
			firstUnderfulfilledDate: null,
		};
		postingTotals.requestedAmount += event.requestedAmount;
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
			unfulfilledAmount: 0,
		};
		dateTotals.requestedAmount += event.requestedAmount;
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
				unfulfilledAmount: 0,
				firstUnderfulfilledDate: null,
			};
			const amounts = reportedAmounts(
				totals.requestedAmount,
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
				utilizationRate:
					amounts.requestedAmount > 0
						? amounts.realizedAmount / amounts.requestedAmount
						: 0,
				firstUnderfulfilledDate: totals.firstUnderfulfilledDate,
				unfulfilledAmount: amounts.unfulfilledAmount,
			};
		});
	const dates = [...totalsByDate.entries()]
		.map(([date, totals]): PostingFulfillmentDateSummary => {
			const amounts = reportedAmounts(
				totals.requestedAmount,
				totals.unfulfilledAmount,
			);
			return { date, ...amounts };
		})
		.sort((left, right) => left.date.localeCompare(right.date));
	const amounts = reportedAmounts(requestedAmount, unfulfilledAmount);
	return {
		...amounts,
		completionRate:
			amounts.requestedAmount > 0
				? amounts.realizedAmount / amounts.requestedAmount
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
