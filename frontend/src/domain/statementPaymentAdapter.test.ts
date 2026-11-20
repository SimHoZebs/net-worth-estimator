import { describe, expect, it } from "vitest";
import type { StatementAllocationRead } from "@/api/generated/model/statementAllocationRead.ts";
import {
	hasKnownBalance,
	statementLabel,
	statementStatusFromTotals,
	toDerivedCardStatement,
	toStatementPaymentSuggestion,
	type KnownBalanceRead,
} from "./statementPaymentAdapter.ts";

const octStatement: KnownBalanceRead["statement"] = {
	id: "2026-10-19~card-a",
	accountId: "card-a",
	closingDate: "2026-10-19",
	dueDate: "2026-11-10",
	balance: 1000,
	currency: "USD",
	kind: "closed",
};

const novStatement: KnownBalanceRead["statement"] = {
	id: "2026-11-19~card-a",
	accountId: "card-a",
	closingDate: "2026-11-19",
	dueDate: "2026-12-10",
	balance: 410,
	currency: "USD",
	kind: "closed",
};

function known(
	overrides: Partial<Omit<KnownBalanceRead, "statement">> & {
		statement?: KnownBalanceRead["statement"];
	} = {},
): KnownBalanceRead {
	return {
		statement: octStatement,
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
		expect(statementLabel(octStatement)).toBe("Oct 19, 2026 statement");
	});

	it("derives status from the authoritative totals", () => {
		expect(statementStatusFromTotals(0, 1000)).toBe("open");
		expect(statementStatusFromTotals(724.45, 275.55)).toBe("partially-paid");
		expect(statementStatusFromTotals(1000, 0)).toBe("paid-in-full");
	});

	it("maps a derived statement with its nullable billed amount and due date", () => {
		const statement = toDerivedCardStatement(
			known({ allocated: 724.45, remaining: 275.55 }),
		);
		expect(statement).toMatchObject({
			id: "2026-10-19~card-a",
			accountId: "card-a",
			closingDate: "2026-10-19",
			billedAmount: 1000,
			remaining: 275.55,
			allocated: 724.45,
			dueDate: "2026-11-10",
			status: "partially-paid",
		});
	});

	it("keeps an unknown billed amount and due date unknown", () => {
		const unknown: StatementAllocationRead = {
			statement: { ...octStatement, balance: null, dueDate: null },
			allocations: [],
			allocated: 0,
			remaining: 0,
		};
		expect(hasKnownBalance(unknown)).toBe(false);
		expect(toDerivedCardStatement(unknown)).toMatchObject({
			billedAmount: null,
			remaining: 0,
			allocated: 0,
			dueDate: null,
			status: "unknown",
		});
	});

	it("maps a statement read, transfer evidence, and alternatives", () => {
		const suggestion = toStatementPaymentSuggestion({
			read: known({ allocated: 724.45, remaining: 275.55 }),
			paymentAmount: 275.55,
			evidence: "Both sides of this card payment are observed.",
			paymentEvidence: [
				{ code: "amount", reason: "Same cents on both legs." },
				{ code: "date", reason: "Posted after the close." },
			],
			alternatives: [known({ statement: novStatement, remaining: 410 })],
			actions,
		});
		expect(suggestion).toMatchObject({
			key: "2026-10-19~card-a",
			statementId: "2026-10-19~card-a",
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
				statementId: "2026-11-19~card-a",
				label: "Nov 19, 2026 statement",
				statementClose: "2026-11-19",
				remainingBalance: 410,
			},
		]);
	});

	it("leaves matcher detail empty when the candidate has no reasons", () => {
		const suggestion = toStatementPaymentSuggestion({
			read: known(),
			paymentAmount: 275.55,
			evidence: null,
			actions,
		});
		expect(suggestion.matcherDetail).toBeNull();
		expect(suggestion.status).toBe("open");
	});
});
