import { useState } from "react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";

/** Selection is local identity, never a second copy of financial records. */
export function useTransactionSelection(
	transactions: AccountTransaction[],
	planTransactions: Map<string, Transaction>,
) {
	const [id, setId] = useState<string | null>(null);
	const transaction = transactions.find((item) => item.id === id);
	const planTransaction = transaction
		? planTransactions.get(transaction.transactionId)
		: undefined;
	const exists = Boolean(transaction && planTransaction);
	if (id !== null && !exists) setId(null);
	return {
		selected:
			transaction && planTransaction ? { transaction, planTransaction } : null,
		inspect: (transaction: AccountTransaction) => setId(transaction.id),
		close: () => setId(null),
	};
}
