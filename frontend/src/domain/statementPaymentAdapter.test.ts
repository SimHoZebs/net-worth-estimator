import { describe, expect, it } from "vitest";
import type { StatementAllocationRead } from "@/api/generated/model/statementAllocationRead.ts";
import {
	statementLabel,
	statementStatusFromTotals,
	toStatementPaymentSuggestion,
} from "./statementPaymentAdapter.ts";

function read(
	overrides: Partial<StatementAllocationRead> = {},
): StatementAllocationRead {
	return {
		statement: {
			id: "stmt-oct",
			accountId: "card-a",
			closingDate: "2026-10-19",
			dueDate: "2026-11-10",
			balance: 1000,
			currency: "USD",
			createdAt: 0,
		},
		allocations: [],
		allocated: 0,
		remaining: 1000,
		...overrides,
	};
}

const actions = {
	apply: true,
	applyPartial: true,
	dismiss: true,
	undo: false,
};

describe("statement payment adapter", () => {
	it("labels a statement from its observed close date", () => {
		expect(statementLabel(read().statement)).toBe("Oct 19, 2026 statement");
	});

	it("derives status from the authoritative totals", () => {
		expect(statementStatusFromTotals(0, 1000)).toBe("open");
		expect(statementStatusFromTotals(724.45, 275.55)).toBe("partially-paid");
		expect(statementStatusFromTotals(1000, 0)).toBe("paid-in-full");
	});

	it("maps a statement read, transfer evidence, and alternatives", () => {
		const suggestion = toStatementPaymentSuggestion({
			read: read({ allocated: 724.45, remaining: 275.55 }),
			paymentAmount: 275.55,
			evidence: "Both sides of this card payment are observed.",
			paymentEvidence: [
				{ code: "amount", reason: "Same cents on both legs." },
				{ code: "date", reason: "Posted after the close." },
			],
			alternatives: [
				read({
					statement: {
						id: "stmt-nov",
						accountId: "card-a",
						closingDate: "2026-11-19",
						dueDate: "2026-12-10",
						balance: 410,
						currency: "USD",
						createdAt: 0,
					},
					remaining: 410,
				}),
			],
			actions,
		});
		expect(suggestion).toMatchObject({
			key: "stmt-oct",
			statementId: "stmt-oct",
			statementLabel: "Oct 19, 2026 statement",
			statementClose: "2026-10-19",
			dueDate: "2026-11-10",
			statementBalance: 1000,
			remainingBalance: 275.55,
			appliedAmount: 724.45,
			status: "partially-paid",
			paymentAmount: 275.55,
			evidence: "Both sides of this card payment are observed.",
			matcherDetail: "Same cents on both legs. Posted after the close.",
		});
		expect(suggestion.alternatives).toEqual([
			{
				statementId: "stmt-nov",
				label: "Nov 19, 2026 statement",
				statementClose: "2026-11-19",
				remainingBalance: 410,
			},
		]);
	});

	it("leaves matcher detail empty when the candidate has no reasons", () => {
		const suggestion = toStatementPaymentSuggestion({
			read: read(),
			paymentAmount: 275.55,
			evidence: null,
			actions,
		});
		expect(suggestion.matcherDetail).toBeNull();
		expect(suggestion.status).toBe("open");
	});
});
