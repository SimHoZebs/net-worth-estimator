import { useMemo } from "react";
import { currency, formatDate } from "@/lib/format";
import type {
	FinancialModelDocument,
	PostingFulfillmentPathResult,
	PostingFulfillmentPostingSummary,
} from "@/lib/projection";

export interface DashboardDerivedValues {
	firstProjectedEvent: PostingFulfillmentPathResult["events"][number] | null;
	firstUnderfulfilledDate: string | null;
	biggestShortfallPosting: PostingFulfillmentPostingSummary | null;
	postingSummaries: PostingFulfillmentPostingSummary[] | null;
	fulfillmentAvailable: boolean;
	enabledPostingCount: number;
	requestedPostingAmount: number;
	realizedPostingAmount: number;
	destinationLimitedPostingAmount: number;
	postingUtilizationRate: number;
	blockerValue: string;
	blockerDetail: string;
	nextEventDetail: string;
}

export function useDashboardDerivedValues(
	document: FinancialModelDocument,
	fulfillment: PostingFulfillmentPathResult | null,
): DashboardDerivedValues {
	return useMemo(() => {
		const firstProjectedEvent = fulfillment?.events[0] ?? null;
		const firstUnderfulfilledDate =
			fulfillment?.firstUnderfulfilledDate ?? null;
		const biggestShortfallPosting =
			fulfillment?.postings
				.filter((summary) => summary.unfulfilledAmount > 0)
				.sort(
					(left, right) => right.unfulfilledAmount - left.unfulfilledAmount,
				)[0] ?? null;
		const enabledPostingCount = document.postings.filter(
			(posting) => posting.enabled,
		).length;
		const requestedPostingAmount = fulfillment?.requestedAmount ?? 0;
		const realizedPostingAmount = fulfillment?.realizedAmount ?? 0;
		const destinationLimitedPostingAmount =
			fulfillment?.destinationLimitedAmount ?? 0;
		const postingUtilizationRate = fulfillment?.completionRate ?? 0;
		const blockerValue =
			biggestShortfallPosting?.label ??
			(fulfillment ? "No constraint showing" : "Evaluation unavailable");
		const blockerDetail = biggestShortfallPosting
			? biggestShortfallPosting.firstUnderfulfilledDate
				? `Starting ${formatDate(biggestShortfallPosting.firstUnderfulfilledDate)}, account constraints limit this scheduled transaction. Total underfulfilled amount: ${currency.format(biggestShortfallPosting.unfulfilledAmount)}.`
				: `Account constraints limit this scheduled transaction by ${currency.format(biggestShortfallPosting.unfulfilledAmount)}.`
			: fulfillment
				? "No scheduled transaction is currently limited by account constraints."
				: "Enable a healthy posting-fulfillment evaluation to inspect transaction constraints.";
		const nextEventDetail =
			fulfillment === null
				? "Enable a healthy posting-fulfillment evaluation to inspect projected transactions."
				: firstProjectedEvent === null
					? "No projected transactions are scheduled after the historical balance history."
					: `${currency.format(firstProjectedEvent.requestedAmount)} requested and ${currency.format(firstProjectedEvent.realizedAmount)} applied${firstProjectedEvent.unfulfilledAmount > 0 ? `, leaving ${currency.format(firstProjectedEvent.unfulfilledAmount)} underfulfilled.` : firstProjectedEvent.destinationLimitedAmount > 0 ? `; ${currency.format(firstProjectedEvent.destinationLimitedAmount)} was no longer applicable after the destination reached its limit.` : "."}`;

		return {
			firstProjectedEvent,
			firstUnderfulfilledDate,
			biggestShortfallPosting,
			postingSummaries: fulfillment?.postings ?? null,
			fulfillmentAvailable: fulfillment !== null,
			enabledPostingCount,
			requestedPostingAmount,
			realizedPostingAmount,
			destinationLimitedPostingAmount,
			postingUtilizationRate,
			blockerValue,
			blockerDetail,
			nextEventDetail,
		};
	}, [document, fulfillment]);
}
