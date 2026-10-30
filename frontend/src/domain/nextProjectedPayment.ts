import type { TransactionResult } from "./result.ts";

export interface ProjectedPayment {
	date: string;
	amount: number;
}

/**
 * Earliest server-projected requested payment per rule after today, summed
 * across same-day fragments. Shared by income sources and bill candidates so
 * both lists describe the same upcoming occurrence.
 */
export function nextProjectedPayments({
	transactions,
	rules,
	todayIso,
}: {
	transactions: TransactionResult[];
	rules: { id: string; endDate: string | null }[];
	todayIso: string;
}): Map<string, ProjectedPayment> {
	const today = todayIso.slice(0, 10);
	const known = new Map(rules.map((rule) => [rule.id, rule]));
	const next = new Map<string, ProjectedPayment>();
	for (const transaction of transactions) {
		const rule = known.get(transaction.transactionId);
		if (!rule || transaction.date <= today || transaction.requested <= 0) continue;
		if (rule.endDate !== null && transaction.date > rule.endDate) continue;
		const previous = next.get(rule.id);
		if (!previous || transaction.date < previous.date) {
			next.set(rule.id, {
				date: transaction.date,
				amount: transaction.requested,
			});
		} else if (transaction.date === previous.date) {
			previous.amount += transaction.requested;
		}
	}
	return next;
}
