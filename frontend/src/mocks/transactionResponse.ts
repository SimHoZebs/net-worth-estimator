import type { FinancialModel } from "../api/contracts.ts";

// Cache priming and HTTP responses share the same raw row and ownership flags.
export function transactionResponse(
	transaction: FinancialModel["transactions"][number],
) {
	return {
		...transaction,
		syncOwned: Boolean(transaction.source && transaction.source !== "user"),
		readOnly: false,
		source: transaction.source ?? "user",
	};
}
