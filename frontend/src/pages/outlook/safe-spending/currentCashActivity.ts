import {
	accountTransactions,
	type AccountTransaction,
} from "@/domain/accountActivity.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { transactionCategoryLabels } from "@/domain/categories.ts";

/** Routing excludes internal movements. The server's accepted category separates
 * received income from refunds; unclassified incoming evidence stays unknown. */
export function receivedMonthlyIncome({
	accounts,
	transactions,
	spendingIds,
	today,
}: {
	accounts: Account[];
	transactions: Transaction[];
	spendingIds: string[];
	today: string;
}): number | null {
	if (
		!spendingIds.length ||
		spendingIds.some(
			(id) =>
				!accounts.some(
					(account) =>
						account.id === id && !account.archived && account.enabled,
				),
		)
	)
		return null;
	const saved = new Map(transactions.map((row) => [row.id, row]));
	const seen = new Set<string>();
	let cents = 0;
	for (const id of spendingIds) {
		for (const row of accountTransactions({
			accountId: id,
			accounts,
			transactions,
			startDate: today,
		})) {
			if (
				row.source !== "historical" ||
				row.flow === "transfer" ||
				row.pending ||
				row.void ||
				row.excluded ||
				row.date < `${today.slice(0, 7)}-01` ||
				row.date > today ||
				seen.has(row.transactionId)
			)
				continue;
			const original = saved.get(row.transactionId);
			if (!original?.enabled) continue;
			if (original.category !== "INCOME") {
				if (
					row.direction === "in" &&
					(!original.category ||
						!Object.hasOwn(transactionCategoryLabels, original.category))
				)
					return null;
				continue;
			}
			if (!original.amountKnown || !Number.isFinite(row.amount)) return null;
			seen.add(row.transactionId);
			cents +=
				Math.round(row.amount * 100) * (row.direction === "out" ? -1 : 1);
		}
	}
	return cents / 100;
}

/** Preserve exact chronology through display projection, including posted-time
 * fallback already resolved by transactionToDisplay for untimed transactions. */
export function currentSpendingActivity(
	rows: AccountTransaction[],
	transactions: Transaction[],
): AccountTransaction[] {
	const saved = new Map(transactions.map((row) => [row.id, row]));
	return rows.map((row) => {
		// A zero/unresolved debit has no negative delta for accountTransactions
		// to infer direction from. Its external-expense routing still owns it.
		if (row.flow === "expense" && row.amount === 0)
			row = { ...row, direction: "out" };
		const category = saved.get(row.transactionId)?.category;
		const transfer = row.flow === "transfer";
		const expenseCredit =
			row.direction === "in" &&
			category !== undefined &&
			category !== null &&
			Object.hasOwn(transactionCategoryLabels, category) &&
			category !== "INCOME" &&
			category !== "TRANSFER_IN" &&
			category !== "TRANSFER_OUT";
		row = {
			...row,
			spendingAmountUnknown:
				!transfer &&
				category !== "INCOME" &&
				(row.direction === "out" || expenseCredit) &&
				saved.get(row.transactionId)?.amountKnown === false,
			spendingAmount:
				transfer || category === "INCOME"
					? 0
					: row.direction === "out"
						? row.amount
						: category &&
							  Object.hasOwn(transactionCategoryLabels, category) &&
							  category !== "INCOME" &&
							  category !== "TRANSFER_IN" &&
							  category !== "TRANSFER_OUT"
							? -row.amount
							: 0,
		};
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
	cycleStart,
	cycleEnd,
	today,
}: {
	accounts: Account[];
	transactions: Transaction[];
	spendingIds: string[];
	cycleStart: string;
	cycleEnd: string;
	today: string;
}): AccountTransaction[] {
	const saved = new Map(transactions.map((row) => [row.id, row]));
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
				(row.direction === "out" ||
					row.flow === "income" ||
					row.flow === "expense") &&
				row.date >= cycleStart &&
				row.date <= today &&
				row.date <= cycleEnd
			);
		});
}
