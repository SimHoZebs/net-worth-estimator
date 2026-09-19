import type { FinancialModelDocument } from "@/lib/projection";
import { getExpression } from "@/lib/projection";

export interface PostingObservation {
	id: string;
	postingId: string;
	accountId: string;
	bookedDate: string;
	amount: number | null;
	currency: "USD";
	description: string;
	counterpartyName: string | null;
}

export interface PostingObservationDataset {
	postings: PostingObservation[];
}

/**
 * Best-effort constant evaluator for observation display amounts. Handles
 * numeric literals and constant arithmetic (+ - * / parentheses) only.
 * Anything referencing postings, accounts, or rates stays null; the Go
 * backend remains the single source of truth for computed amounts.
 */
function evaluateConstantExpression(expression: string): number | null {
	const trimmed = expression.trim();
	if (trimmed === "") return null;
	if (!/^[0-9\s+\-*/().]+$/.test(trimmed)) return null;
	try {
		const value = new Function(
			`"use strict"; return (${trimmed});`,
		)() as unknown;
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

export function buildPostingObservationDataset(
	document: FinancialModelDocument,
): PostingObservationDataset {
	const postings: PostingObservation[] = [];
	for (const posting of document.postings) {
		if (
			!posting.enabled ||
			posting.frequency !== "once" ||
			posting.sourceAccountId !== null ||
			!posting.destinations ||
			posting.destinations.length === 0
		)
			continue;
		let amount: number | null = null;
		const expression = getExpression(posting);
		if (
			expression !== null &&
			Object.keys(posting.amount.inputs).length === 0
		) {
			amount = evaluateConstantExpression(expression);
		}
		postings.push({
			id: posting.id,
			postingId: posting.id,
			accountId: posting.destinations[0]!,
			bookedDate: posting.startDate,
			amount,
			currency: "USD",
			description: posting.label,
			counterpartyName: null,
		});
	}
	return {
		postings: postings.sort(
			(left, right) =>
				left.bookedDate.localeCompare(right.bookedDate) ||
				left.id.localeCompare(right.id),
		),
	};
}
