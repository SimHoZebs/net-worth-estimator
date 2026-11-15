import {
	accountTransactions,
	type AccountTransaction,
} from "@/domain/accountActivity.ts";
import type { Account, Transaction } from "@/domain/model.ts";

/** Preserve exact chronology through display projection, including posted-time
 * fallback already resolved by transactionToDisplay for untimed transactions. */
export function currentSpendingActivity(
	rows: AccountTransaction[],
	transactions: Transaction[],
): AccountTransaction[] {
	const saved = new Map(transactions.map((row) => [row.id, row]));
	return rows.map((row) => {
		if (row.sortDate !== undefined && Number.isFinite(Date.parse(row.sortDate)))
			return row;
		const instant = saved.get(row.transactionId)?.transactionTime;
		return {
			...row,
			sortDate:
				instant !== null && instant !== undefined && Number.isFinite(instant)
					? new Date(instant * 1000).toISOString()
					: row.date,
		};
	});
}

/** Recorded enabled cash only. Bank holds already reflected by available cash
 * cannot be charged again. Explicit routing, never names or amounts, identifies
 * transfers; the spending owner excludes those while the drawer keeps them. */
export function currentCashActivity({
	accounts,
	transactions,
	spendingIds,
	billIds,
	ruleIds,
	cycleStart,
	cycleEnd,
	today,
}: {
	accounts: Account[];
	transactions: Transaction[];
	spendingIds: string[];
	billIds: string[];
	ruleIds: string[];
	startDate: string;
	cycleStart: string;
	cycleEnd: string;
	today: string;
}): AccountTransaction[] {
	const saved = new Map(transactions.map((row) => [row.id, row]));
	const bills = new Set([...billIds, ...ruleIds]);
	return spendingIds
		.flatMap((accountId) =>
			// Recorded facts through today are independent of the latest balance
			// checkpoint. Do not turn projection occurrences into actual spending.
			accountTransactions({
				accountId,
				accounts,
				transactions,
				startDate: today,
			}),
		)
		.filter((row) => {
			const original = saved.get(row.transactionId);
			return (
				original?.enabled &&
				!row.pending &&
				!row.void &&
				row.direction === "out" &&
				row.date >= cycleStart &&
				row.date <= today &&
				row.date <= cycleEnd &&
				!bills.has(original.claimScheduleId ?? original.id)
			);
		});
}
