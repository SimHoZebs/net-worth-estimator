import type { FinancialModel } from "../api/contracts.ts";
import { todayIso } from "../domain/format.ts";

export function projectionStartDate(model: FinancialModel): string {
	const dates = model.checkpoints.map((checkpoint) =>
		new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10),
	);
	const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
	const posting = model.postings[0];
	return (
		latest ??
		(model.recurrenceRules ?? [])[0]?.startDate ??
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
