import type { TransactionResult } from "./result.ts";

export interface ResolvedTransactionAmount {
	amount: number;
	requested: number;
	date: string;
	occurrences: number;
	constrained: boolean;
}

/**
 * Summarize projected occurrences per transaction definition.
 *
 * Formula-driven postings (interest = balance * rate, 401(k) = pay * %,
 * payoffs = abs(balance), ...) have no single static amount. The Plan list
 * shows the earliest projected occurrence as the representative figure so
 * the row never dead-ends at "Unavailable".
 */
export function resolveTransactionAmounts(
	transactions: TransactionResult[],
): Map<string, ResolvedTransactionAmount> {
	const grouped = new Map<string, TransactionResult[]>();
	for (const transaction of transactions) {
		const group = grouped.get(transaction.transactionId);
		if (group) group.push(transaction);
		else grouped.set(transaction.transactionId, [transaction]);
	}
	const resolved = new Map<string, ResolvedTransactionAmount>();
	for (const [transactionId, group] of grouped) {
		const ordered = [...group].sort(
			(left, right) =>
				left.date.localeCompare(right.date) || left.requested - right.requested,
		);
		const first = ordered[0];
		if (!first) continue;
		const amount = Number.isFinite(first.realized)
			? first.realized
			: first.requested;
		resolved.set(transactionId, {
			amount,
			requested: first.requested,
			date: first.date,
			occurrences: ordered.length,
			constrained: first.requested - first.realized > 0.01,
		});
	}
	return resolved;
}
