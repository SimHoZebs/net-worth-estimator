import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";

/** The one lifecycle rule for recorded evidence: only enabled, settled,
 * dated transactions count. Void, pending and disabled rows never enter
 * actual spending, so they must not suppress a projected bill either. */
export function isPostedTransaction(
	row: Pick<Transaction, "kind" | "enabled" | "void" | "pending" | "startDate">,
): boolean {
	return (
		row.kind === "transaction" &&
		row.enabled &&
		!row.void &&
		!row.pending &&
		Boolean(row.startDate)
	);
}

/**
 * Recorded transactions as result rows for the closed-cycle cash payments
 * view. A claim renames the row to its rule so a paid bill keeps its identity;
 * the row keeps the day it actually happened. No projection rows or dedup are
 * involved: this stream is only recorded evidence.
 */
export function postedTransactionResults(
	transactions: readonly Transaction[],
): TransactionResult[] {
	const rows: TransactionResult[] = [];
	for (const row of transactions) {
		if (!isPostedTransaction(row)) continue;
		rows.push({
			date: row.startDate,
			transactionId: row.claimScheduleId ?? row.id,
			name: row.name,
			requested: row.amount,
			realized: row.amount,
			fromId: row.fromId,
			toId: row.toId,
			available: null,
			constraint: null,
			accountDeltas: [],
			posted: true,
			claimed: row.claimScheduleId !== null,
		});
	}
	return rows;
}
