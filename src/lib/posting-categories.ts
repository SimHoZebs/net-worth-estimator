import { getExpression, type Posting } from "@/lib/projection";

const SALARY_POSTING_ID = "salary";
const CHECKING_ACCOUNT_ID = "checking";
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

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

export function arithmeticIdentifiers(arithmetic: string): string[] {
	return Array.from(new Set(arithmetic.match(IDENTIFIER_PATTERN) ?? [])).filter(
		(identifier) => identifier !== "abs" && identifier !== "rate",
	);
}

export function associatedAccountIds(
	posting: Posting,
	accountIds: ReadonlySet<string>,
): string[] {
	const associated = new Set<string>();
	if (posting.sourceAccountId && accountIds.has(posting.sourceAccountId)) {
		associated.add(posting.sourceAccountId);
	}
	for (const destination of posting.destinations ?? []) {
		if (accountIds.has(destination)) associated.add(destination);
	}
	for (const identifier of arithmeticIdentifiers(
		getExpression(posting) ?? "",
	)) {
		if (accountIds.has(identifier)) associated.add(identifier);
	}
	return Array.from(associated);
}

export function isScheduledTransaction(posting: Posting): boolean {
	if (posting.frequency === "once") return false;
	return (
		posting.id === SALARY_POSTING_ID ||
		posting.sourceAccountId === CHECKING_ACCOUNT_ID ||
		posting.destinations?.includes(CHECKING_ACCOUNT_ID) === true ||
		arithmeticIdentifiers(getExpression(posting) ?? "").includes(
			SALARY_POSTING_ID,
		)
	);
}

export function isPastScheduledPosting(
	posting: Posting,
	projectionStartDate: string,
): boolean {
	return posting.endDate !== null && posting.endDate < projectionStartDate;
}

export function partitionPostings(postings: readonly Posting[]) {
	const scheduledTransactions: Posting[] = [];
	const accountRules: Posting[] = [];
	const transactionHistory: Posting[] = [];

	for (const posting of postings) {
		if (posting.frequency === "once") {
			transactionHistory.push(posting);
		} else if (isScheduledTransaction(posting)) {
			scheduledTransactions.push(posting);
		} else {
			accountRules.push(posting);
		}
	}

	return { scheduledTransactions, accountRules, transactionHistory };
}

export function categorizePosting(p: Posting): PostingCategory {
	const label = p.label.toLowerCase();
	const arithmetic = (getExpression(p) ?? "").toLowerCase();

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
