import type { FinancialModelDocument } from "@/lib/projection";
import {
	getExpression,
	resolvePostingAmountDescriptor,
} from "@/lib/projection";

export interface PostingObservation {
	id: string;
	postingId: string;
	accountId: string;
	bookedDate: string;
	amount: number | null;
	currency: "USD";
	description: string;
	counterpartyName: string | null;
}

export interface PostingObservationDataset {
	postings: PostingObservation[];
}

export function buildPostingObservationDataset(
	document: FinancialModelDocument,
): PostingObservationDataset {
	const postings: PostingObservation[] = [];
	for (const posting of document.postings) {
		if (
			!posting.enabled ||
			posting.frequency !== "once" ||
			posting.sourceAccountId !== null ||
			!posting.destinations ||
			posting.destinations.length === 0
		)
			continue;
		let amount: number | null = null;
		if (
			getExpression(posting) !== null &&
			Object.keys(posting.amount.inputs).length === 0
		) {
			try {
				const resolvedAmount = resolvePostingAmountDescriptor(posting.amount, {
					balances: {},
					latestRealizedPostingAmounts: new Map(),
					realizedPostingAmountsByYear: new Map(),
					date: posting.startDate,
					occurrenceRate: 0,
				});
				amount = Number.isFinite(resolvedAmount) ? resolvedAmount : null;
			} catch {
				amount = null;
			}
		}
		postings.push({
			id: posting.id,
			postingId: posting.id,
			accountId: posting.destinations[0]!,
			bookedDate: posting.startDate,
			amount,
			currency: "USD",
			description: posting.label,
			counterpartyName: null,
		});
	}
	return {
		postings: postings.sort(
			(left, right) =>
				left.bookedDate.localeCompare(right.bookedDate) ||
				left.id.localeCompare(right.id),
		),
	};
}
