import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";
import { isPostedTransaction } from "./safeSpendingHistory.ts";
import { groupByDate } from "./safeSpendingMath.ts";

export interface RecurringBillIncrease {
	date: string;
	amount: number;
	name?: string;
}

/** Every selected bill occurrence grouped by date, claimed or not. */
export function recurringBillMarkers(
	bills: readonly TransactionResult[],
): RecurringBillIncrease[] {
	return groupByDate(
		bills,
		(row) =>
			Number.isFinite(row.requested) && row.requested > 0
				? row.requested
				: undefined,
		(row) => row.name,
	);
}

/**
 * Projected increases come from the selected bills in the safe card cycle. A
 * bill whose occurrence a recorded transaction claims is already in actual
 * spending, so it is left out of the projected line to avoid counting it twice.
 */
export function recurringBillIncreases({
	bills,
	transactions,
}: {
	bills: readonly TransactionResult[];
	transactions: readonly Transaction[];
}): RecurringBillIncrease[] {
	const claimed = new Set<string>();
	for (const row of transactions) {
		if (!isPostedTransaction(row)) continue;
		if (!row.claimScheduleId || !row.claimOccurrenceDate) continue;
		claimed.add(
			`${row.claimScheduleId}|${row.claimOccurrenceDate.slice(0, 10)}`,
		);
	}
	return recurringBillMarkers(
		bills.filter((row) => !claimed.has(`${row.transactionId}|${row.date}`)),
	);
}
