import type { Posting } from "@/lib/projection";

export interface PostingCategory {
	type: "income" | "expense" | "transfer" | "investment";
	category: string;
}

export function isNumericArithmetic(arithmetic: string): boolean {
	return /^-?\d+(\.\d+)?$/.test(arithmetic.trim());
}

export function parseNumericArithmetic(arithmetic: string): number {
	return Number(arithmetic.trim());
}

export function categorizePosting(p: Posting): PostingCategory {
	const label = p.label.toLowerCase();
	const arithmetic = p.arithmetic.toLowerCase();

	if (!p.sourceAccountId) {
		if (
			label.includes("salary") ||
			label.includes("income") ||
			label.includes("wage")
		) {
			return { type: "income", category: "Income" };
		}
		return { type: "income", category: "Other income" };
	}

	if (label.includes("tax")) {
		return { type: "expense", category: "Taxes" };
	}
	if (
		label.includes("housing") ||
		label.includes("rent") ||
		label.includes("mortgage")
	) {
		return { type: "expense", category: "Housing" };
	}
	if (
		label.includes("living") ||
		label.includes("expense") ||
		label.includes("grocery") ||
		label.includes("utility")
	) {
		return { type: "expense", category: "Living expenses" };
	}
	if (
		label.includes("loan") ||
		label.includes("debt") ||
		label.includes("payment")
	) {
		return { type: "expense", category: "Debt payments" };
	}
	if (
		label.includes("401") ||
		label.includes("ira") ||
		label.includes("brokerage") ||
		label.includes("invest")
	) {
		return { type: "investment", category: "Investing" };
	}
	if (arithmetic.startsWith("-")) {
		return { type: "expense", category: "Other expenses" };
	}
	return { type: "transfer", category: "Transfers" };
}
