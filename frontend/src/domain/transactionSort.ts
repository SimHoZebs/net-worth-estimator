export type TransactionOrder = "newest" | "oldest";

export const DEFAULT_TRANSACTION_ORDER: TransactionOrder = "newest";

export function toggleTransactionOrder(
	order: TransactionOrder,
): TransactionOrder {
	return order === "oldest" ? "newest" : "oldest";
}

export function transactionOrderLabel(order: TransactionOrder): string {
	return order === "oldest" ? "Oldest first" : "Newest first";
}

function compareDates(aDate: string, bDate: string): number {
	return aDate.localeCompare(bDate);
}

/**
 * Shared date comparator for every transaction list. Dates are ISO
 * `YYYY-MM-DD` strings, so lexical comparison is chronological. Newest
 * first is the default across the product.
 */
export function compareTransactionDates({
	aDate,
	bDate,
	aId = "",
	bId = "",
	order = DEFAULT_TRANSACTION_ORDER,
}: {
	aDate: string;
	bDate: string;
	aId?: string;
	bId?: string;
	order?: TransactionOrder;
}): number {
	const direction = order === "oldest" ? 1 : -1;
	return direction * compareDates(aDate, bDate) || aId.localeCompare(bId);
}

/**
 * Shared sorter for transaction-like rows. Returns a new array and never
 * mutates the input. `getDate` selects the ISO date, `getId` an optional
 * stable tie-breaker.
 */
export function sortTransactionsByDate<T>({
	items,
	getDate,
	getId,
	order = DEFAULT_TRANSACTION_ORDER,
}: {
	items: readonly T[];
	getDate: (item: T) => string;
	getId?: (item: T) => string;
	order?: TransactionOrder;
}): T[] {
	return [...items].sort((a, b) =>
		compareTransactionDates({
			aDate: getDate(a),
			bDate: getDate(b),
			aId: getId?.(a) ?? "",
			bId: getId?.(b) ?? "",
			order,
		}),
	);
}
