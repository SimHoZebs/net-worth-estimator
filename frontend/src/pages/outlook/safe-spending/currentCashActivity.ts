import {
	accountTransactions,
	type AccountTransaction,
} from "@/domain/accountActivity.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import { isSpendCategory } from "@/domain/safeSpendingMath.ts";

/**
 * Card settlement legs move cash to the card without creating new spending.
 * The bank sync leaves the checking leg as an external expense with no
 * destination, so it is detected by name. Genuine transfers keep their
 * explicit routing and never reach this test.
 */
export function isCardSettlement(name: string): boolean {
	return /payment\s+to.*card/i.test(name);
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
		// Card settlements move cash to the card but do not create new
		// spending: the purchase already counted on the card. The bank
		// sync leaves the checking leg as an external expense with no
		// destination, so detect it by name and keep it inspectable as a
		// transfer instead of consuming the purchase budget twice.
		const cardSettlement =
			row.flow === "expense" &&
			row.direction === "out" &&
			isCardSettlement(row.name);
		const transfer = row.flow === "transfer" || cardSettlement;
		if (cardSettlement) row = { ...row, flow: "transfer" };
		const expenseCredit = row.direction === "in" && isSpendCategory(category);
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
						: isSpendCategory(category)
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
 * cannot be charged again. Explicit routing identifies transfers; card
 * settlement legs are the documented exception because the sync leaves
 * them routeless, so they are detected by name in currentSpendingActivity.
 * The spending owner excludes transfers while the drawer keeps them. */
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
