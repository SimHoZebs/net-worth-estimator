import { useState } from "react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Movement } from "../../domain/model.ts";

/** Selection is local identity, never a second copy of financial records. */
export function useTransactionSelection(
	transactions: AccountTransaction[],
	movements: Map<string, Movement>,
) {
	const [id, setId] = useState<string | null>(null);
	const transaction = transactions.find((item) => item.id === id);
	const movement = transaction
		? movements.get(transaction.movementId)
		: undefined;
	const exists = Boolean(transaction && movement);
	if (id !== null && !exists) setId(null);
	return {
		selected: transaction && movement ? { transaction, movement } : null,
		inspect: (transaction: AccountTransaction) => setId(transaction.id),
		close: () => setId(null),
	};
}
