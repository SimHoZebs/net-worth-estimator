import { useState } from "react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";

/** Selection is local identity, never a second copy of financial records. */
export function useTransactionSelection(
	transactions: AccountTransaction[],
	savedTransactions: Map<string, Transaction>,
) {
	const [id, setId] = useState<string | null>(null);
	const transaction = transactions.find((item) => item.id === id);
	const savedTransaction = transaction
		? savedTransactions.get(transaction.transactionId)
		: undefined;
	const exists = Boolean(transaction && savedTransaction);
	if (id !== null && !exists) setId(null);
	return {
		selected:
			transaction && savedTransaction
				? { transaction, savedTransaction }
				: null,
		inspect: (transaction: AccountTransaction) => setId(transaction.id),
		close: () => setId(null),
	};
}
