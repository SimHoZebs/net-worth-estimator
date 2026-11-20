import { describe, expect, it } from "vitest";
import {
	maxApplyAmount,
	statementStatusLabel,
	statementSuggestionKey,
	validateApplyAmount,
	type StatementPaymentSuggestion,
} from "./statementPayment.ts";

function suggestion(
	overrides: Partial<StatementPaymentSuggestion> = {},
): StatementPaymentSuggestion {
	return {
		key: "oct-2026",
		statementId: "stmt-oct",
		statementLabel: "October 2026 statement",
		statementClose: "2026-10-19",
		dueDate: "2026-11-10",
		statementBalance: 1000,
		remainingBalance: 1000,
		appliedAmount: 0,
		status: "open",
		paymentAmount: 275.55,
		evidence: "Both sides of this card payment are observed.",
		matcherDetail: null,
		alternatives: [],
		actions: {
			apply: true,
			applyPartial: true,
			dismiss: true,
			undo: false,
		},
		...overrides,
	};
}

describe("statement payment view model", () => {
	it("labels every status in plain terms", () => {
		expect(statementStatusLabel("open")).toBe("Open");
		expect(statementStatusLabel("partially-paid")).toBe("Partially paid");
		expect(statementStatusLabel("paid-in-full")).toBe("Paid in full");
	});

	it("caps the applyable amount at the smaller of payment and remaining", () => {
		expect(maxApplyAmount(suggestion())).toBe(275.55);
		expect(
			maxApplyAmount(
				suggestion({ remainingBalance: 120, paymentAmount: 275.55 }),
			),
		).toBe(120);
		expect(
			maxApplyAmount(
				suggestion({ remainingBalance: 500, paymentAmount: 275.55 }),
			),
		).toBe(275.55);
	});

	it("gives a stable key scoped to the statement suggestion kind", () => {
		expect(statementSuggestionKey(suggestion())).toBe("statement-oct-2026");
	});

	it("accepts the full payment and a smaller partial amount", () => {
		expect(validateApplyAmount("275.55", suggestion())).toBeNull();
		expect(validateApplyAmount("100", suggestion())).toBeNull();
	});

	it("rejects empty, non-positive, and over-cap amounts", () => {
		expect(validateApplyAmount("", suggestion())).toMatch(/enter the amount/i);
		expect(validateApplyAmount("abc", suggestion())).toMatch(
			/enter the amount/i,
		);
		expect(validateApplyAmount("0", suggestion())).toMatch(
			/greater than zero/i,
		);
		expect(validateApplyAmount("-5", suggestion())).toMatch(
			/greater than zero/i,
		);
		expect(validateApplyAmount("300", suggestion())).toMatch(/card payment/i);
		expect(
			validateApplyAmount(
				"200",
				suggestion({ remainingBalance: 120, paymentAmount: 500 }),
			),
		).toMatch(/remaining statement balance/i);
	});
});
