import { describe, expect, it } from "vitest";
import type { StatementPaymentSuggestion } from "@/domain/statementPayment.ts";
import { buildInsightSuggestions } from "./TransactionInsights.tsx";

const match: StatementPaymentSuggestion = {
	key: "oct-2026",
	statementId: "stmt-oct",
	statementLabel: "October 2026 statement",
	statementClose: "2026-10-19",
	dueDate: "2026-11-10",
	statementBalance: 1000,
	remainingBalance: 275.55,
	appliedAmount: 724.45,
	status: "partially-paid",
	paymentAmount: 275.55,
	evidence: null,
	matcherDetail: null,
	alternatives: [],
	actions: {
		apply: true,
		applyPartial: true,
		dismiss: true,
		undo: false,
	},
};

describe("statement suggestions in the insight queue", () => {
	it("places an exact remaining match in the queue as a question", () => {
		const suggestions = buildInsightSuggestions({
			findings: [],
			transactionId: "pay-1",
			statementMatches: [match],
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toEqual({
			kind: "statement",
			match,
			priority: 0,
		});
	});

	it("does not add a statement suggestion when none are supplied", () => {
		expect(
			buildInsightSuggestions({ findings: [], transactionId: "pay-1" }),
		).toEqual([]);
	});
});
