import type { AccountTransaction } from "../domain/accountActivity.ts";

/** Projected row ids include a list index, not just occurrence identity. */
export function transactionSelectionKey(
	transaction: AccountTransaction,
): string {
	return transaction.source === "historical"
		? transaction.id
		: JSON.stringify([transaction.transactionId, transaction.date]);
}
