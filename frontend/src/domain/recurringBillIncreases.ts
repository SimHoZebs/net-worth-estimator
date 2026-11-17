import type { TransactionResult } from "./result.ts";
import { groupByDate } from "./safeSpendingMath.ts";

export interface RecurringBillIncrease {
	date: string;
	amount: number;
	name?: string;
}

/**
 * Projected increases read from the selected bills that fall in the safe card
 * cycle. No schedule expansion happens here: dates and amounts come from the
 * bill occurrences already in the history stream, so every increase on the
 * projected line has a matching Bills row. Posted occurrences stay out because
 * their payment is already recorded in actual spending.
 */
export function recurringBillIncreases({
	bills,
}: {
	bills: readonly TransactionResult[];
}): RecurringBillIncrease[] {
	return groupByDate(
		bills.filter((row) => row.posted !== true),
		(row) =>
			Number.isFinite(row.requested) && row.requested > 0
				? row.requested
				: undefined,
		(row) => row.name,
	);
}
