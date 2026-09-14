import type {
	AccountMovementConstraint,
	IsoDate,
	PostingFulfillmentConfig,
} from "../types/model";
import type { PercentileBands } from "../types/stochastic";

export const POSTING_FULFILLMENT_DEFINITION_ID = "posting-fulfillment";
export const DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID = "posting-fulfillment";

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
