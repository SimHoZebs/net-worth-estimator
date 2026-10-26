import type { FinancialModelDocument } from "../api/contracts.ts";
import { todayIso } from "../domain/format.ts";

export function projectionStartDate(document: FinancialModelDocument): string {
	const dates = document.checkpoints.map((checkpoint) => checkpoint.Date);
	const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
	const posting = document.postings.find((item) => !item.purchase);
	return (
		latest ??
		(document.recurrenceRules ?? [])[0]?.startDate ??
		(posting
			? new Date(
					(posting.transactionTime > 0
						? posting.transactionTime
						: posting.postedTime) * 1000,
				)
					.toISOString()
					.slice(0, 10)
			: undefined) ??
		todayIso()
	);
}
