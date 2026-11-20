import type { DerivedStatement } from "@/api/generated/model/derivedStatement.ts";
import type { PaymentEvidence } from "@/api/generated/model/paymentEvidence.ts";
import type { StatementAllocationRead } from "@/api/generated/model/statementAllocationRead.ts";
import type { DerivedCardStatement } from "./derivedStatement.ts";
import { derivedStatementStatus } from "./derivedStatement.ts";
import { dateLabel } from "./format.ts";
import type {
	StatementPaymentActions,
	StatementPaymentOption,
	StatementPaymentSuggestion,
} from "./statementPayment.ts";

/** A statement read whose billed amount is known, so a payment can target it. */
export type KnownBalanceRead = Omit<StatementAllocationRead, "statement"> & {
	statement: Omit<DerivedStatement, "balance"> & { balance: number };
};

/** Statements with an unknown billed amount are never payment targets. */
export function hasKnownBalance(
	read: StatementAllocationRead,
): read is KnownBalanceRead {
	return read.statement.balance !== null;
}

/** Narrow a posted-payment match whose statement can receive an allocation. */
export function isKnownBalanceMatch<
	T extends { read: StatementAllocationRead },
>(match: T): match is T & { read: KnownBalanceRead } {
	return hasKnownBalance(match.read);
}

/** Map a statement allocation read into the derived-statement view model. */
export function toDerivedCardStatement(
	read: StatementAllocationRead,
): DerivedCardStatement {
	const billedAmount = read.statement.balance;
	const remaining = read.remaining;
	const allocated = read.allocated;
	return {
		id: read.statement.id,
		accountId: read.statement.accountId,
		closingDate: read.statement.closingDate,
		billedAmount,
		remaining,
		allocated,
		dueDate: read.statement.dueDate,
		status: derivedStatementStatus({ billedAmount, remaining, allocated }),
	};
}

export function statementLabel(statement: DerivedStatement): string {
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
	read: KnownBalanceRead;
	paymentAmount: number;
	/** Transfer-link evidence composed by the transaction view. */
	evidence: string | null;
	/** Reasons from the posted-payment candidate, shown on request. */
	paymentEvidence?: PaymentEvidence[];
	alternatives?: KnownBalanceRead[];
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
