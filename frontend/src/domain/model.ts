import type { Account, PlannedPurchase, Transaction } from "./modelSchemas.ts";

export type {
	Account,
	Evaluation,
	PlannedPurchase,
	Transaction,
} from "./modelSchemas.ts";

/**
 * A transaction is historical when it is a one-time dated record at or before the
 * projection start. Schedules and later-dated transactions are projected.
 * Planned purchases live in their own slice and never count as history.
 */
export function isHistoricalTransaction(
	transaction: Pick<Transaction, "kind" | "startDate">,
	projectionStartDate: string,
): boolean {
	return (
		transaction.kind === "transaction" &&
		transaction.startDate <= projectionStartDate
	);
}

/** Pending state comes from bank metadata, never the transaction ID. */
export function isPendingTransaction(
	transaction: Pick<Transaction, "pending">,
): boolean {
	return transaction.pending === true;
}

export function isArchivedAccount(account: Pick<Account, "archived">): boolean {
	return account.archived === true;
}

export function visibleAccounts(accounts: Account[]): Account[] {
	return accounts.filter((account) => !account.archived);
}

export function visibleTransactions({
	transactions,
	accounts,
}: {
	transactions: Transaction[];
	accounts: Account[];
}): Transaction[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return transactions;
	return transactions.filter(
		(transaction) =>
			!(transaction.fromId && archivedIds.has(transaction.fromId)) &&
			!(transaction.toId && archivedIds.has(transaction.toId)),
	);
}

export function visiblePlannedPurchases({
	plannedPurchases,
	accounts,
}: {
	plannedPurchases: PlannedPurchase[];
	accounts: Account[];
}): PlannedPurchase[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return plannedPurchases;
	return plannedPurchases.filter(
		(purchase) => !(purchase.fromId && archivedIds.has(purchase.fromId)),
	);
}
