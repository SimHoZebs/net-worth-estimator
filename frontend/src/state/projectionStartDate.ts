import type { FinancialModel } from "../api/contracts.ts";
import { todayIso } from "../domain/format.ts";

export function projectionStartDate(model: FinancialModel): string {
	const dates = model.checkpoints.map((checkpoint) =>
		new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10),
	);
	const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
	const transaction = model.transactions[0];
	return (
		latest ??
		(model.schedules ?? [])[0]?.startDate ??
		(transaction
			? new Date(
					(transaction.transactionTime > 0
						? transaction.transactionTime
						: transaction.postedTime) * 1000,
				)
					.toISOString()
					.slice(0, 10)
			: undefined) ??
		todayIso()
	);
}
