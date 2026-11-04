/**
 * Category keys mirror the server's supported Plaid primary set. The server
 * owns the keys and validation; this map owns display copy only. A new key
 * needs both a server constant and a label here.
 */
export const transactionCategoryLabels = {
	INCOME: "Income",
	TRANSFER_IN: "Transfer in",
	TRANSFER_OUT: "Transfer out",
	LOAN_PAYMENTS: "Loan payments",
	BANK_FEES: "Bank fees",
	ENTERTAINMENT: "Entertainment",
	FOOD_AND_DRINK: "Food & drink",
	GENERAL_MERCHANDISE: "General merchandise",
	HOME_IMPROVEMENT: "Home improvement",
	MEDICAL: "Medical",
	PERSONAL_CARE: "Personal care",
	GENERAL_SERVICES: "General services",
	GOVERNMENT_AND_NON_PROFIT: "Government & nonprofit",
	TRANSPORTATION: "Transportation",
	TRAVEL: "Travel",
	RENT_AND_UTILITIES: "Rent & utilities",
} as const;

export type TransactionCategory = keyof typeof transactionCategoryLabels;
export type TransactionCategorySource = "bank" | "inferred" | "user";

export const transactionCategoryOptions = Object.entries(
	transactionCategoryLabels,
).map(([value, label]) => ({ value: value as TransactionCategory, label }));

export function transactionCategoryLabel(
	category: string | null | undefined,
): string | null {
	if (!category) return null;
	return transactionCategoryLabels[category as TransactionCategory] ?? category;
}

export function transactionCategorySourceOf(
	source: string | null | undefined,
): TransactionCategorySource | null {
	return source === "bank" || source === "inferred" || source === "user"
		? source
		: null;
}

export function transactionCategorySourceLabel(
	source: TransactionCategorySource | null,
): string {
	switch (source) {
		case "bank":
			return "From your bank";
		case "inferred":
			return "Suggested";
		case "user":
			return "Set by you";
		default:
			return "Not categorized";
	}
}
