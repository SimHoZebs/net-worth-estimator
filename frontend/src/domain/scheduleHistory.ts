import type { Transaction } from "./model.ts";
import { sortTransactionsByDate } from "./transactionSort.ts";

/**
 * Recorded postings that claim an occurrence of one schedule. The claim is
 * the only association between a posting and a schedule, so this reads the
 * saved rows instead of the projection. Rows keep the day the transaction
 * happened; the claimed occurrence date only names the guessed occurrence
 * the claim covers. Newest first.
 */
export function scheduleHistoryTransactions({
	scheduleId,
	transactions,
}: {
	scheduleId: string;
	transactions: readonly Transaction[];
}): Transaction[] {
	return sortTransactionsByDate({
		items: transactions.filter(
			(transaction) =>
				transaction.kind === "posting" &&
				transaction.claimScheduleId === scheduleId,
		),
		getDate: (transaction) => transaction.startDate,
		getId: (transaction) => transaction.id,
	});
}
