import type { FinancialModelDocument } from "@/lib/projection";
import { getExpression } from "@/lib/projection";

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
		const expression = getExpression(posting);
		const resolvedAmount =
			expression === null ? Number.NaN : Number(expression);
		const amount = Number.isFinite(resolvedAmount) ? resolvedAmount : null;
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
