import type { CardStatement } from "@/api/generated/model/cardStatement.ts";
import type { PaymentEvidence } from "@/api/generated/model/paymentEvidence.ts";
import type { StatementAllocationRead } from "@/api/generated/model/statementAllocationRead.ts";
import { dateLabel } from "./format.ts";
import type {
	StatementPaymentActions,
	StatementPaymentOption,
	StatementPaymentSuggestion,
} from "./statementPayment.ts";

export function statementLabel(statement: CardStatement): string {
	return `${dateLabel(statement.closingDate, true)} statement`;
}

export function statementStatusFromTotals(
	allocated: number,
	remaining: number,
): StatementPaymentSuggestion["status"] {
	if (remaining <= 0) return "paid-in-full";
	if (allocated > 0) return "partially-paid";
	return "open";
}

/** Map a statement read into one suggestion for a posted card payment. */
export function toStatementPaymentSuggestion({
	read,
	paymentAmount,
	evidence,
	paymentEvidence = [],
	alternatives = [],
	actions,
	key = read.statement.id,
}: {
	read: StatementAllocationRead;
	paymentAmount: number;
	/** Transfer-link evidence composed by the transaction view. */
	evidence: string | null;
	/** Reasons from the posted-payment candidate, shown on request. */
	paymentEvidence?: PaymentEvidence[];
	alternatives?: StatementAllocationRead[];
	actions: StatementPaymentActions;
	key?: string;
}): StatementPaymentSuggestion {
	return {
		key,
		statementId: read.statement.id,
		statementLabel: statementLabel(read.statement),
		statementClose: read.statement.closingDate,
		dueDate: read.statement.dueDate,
		statementBalance: read.statement.balance,
		remainingBalance: read.remaining,
		appliedAmount: read.allocated,
		status: statementStatusFromTotals(read.allocated, read.remaining),
		paymentAmount,
		evidence,
		matcherDetail: paymentEvidence.map((item) => item.reason).join(" ") || null,
		alternatives: alternatives.map((item): StatementPaymentOption => ({
			statementId: item.statement.id,
			label: statementLabel(item.statement),
			statementClose: item.statement.closingDate,
			remainingBalance: item.remaining,
		})),
		actions,
	};
}
