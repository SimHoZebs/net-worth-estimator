/**
 * Contract-independent view model for a card statement derived from a recorded
 * cycle end. A close is an observed fact; the billed amount, the amount applied
 * to it, and the due date are each known or explicitly unknown. The backend
 * contract is mapped into this model at the API boundary.
 */

import {
	knownStatementStatus,
	type StatementPaymentStatus,
} from "./statementPayment.ts";

/** One statement derived from one recorded cycle-end close. */
export interface DerivedCardStatement {
	id: string;
	accountId: string;
	/** Observed cycle-end close date, YYYY-MM-DD. */
	closingDate: string;
	/** Amount the issuer billed, in USD, or null when it was never reported. */
	billedAmount: number | null;
	/** Billed amount less confirmed allocations, or null when not derivable. */
	remaining: number | null;
	/** Confirmed allocations in USD, or null when not derivable. */
	allocated: number | null;
	/** Due date the issuer reported, or null when none is known. */
	dueDate: string | null;
	status: StatementPaymentStatus;
}

/**
 * Derive the lifecycle from the authoritative totals. Any missing amount makes
 * the status unknown; a missing amount is never treated as zero.
 */
export function derivedStatementStatus(statement: {
	billedAmount: number | null;
	remaining: number | null;
	allocated: number | null;
}): StatementPaymentStatus {
	const { billedAmount, remaining, allocated } = statement;
	if (billedAmount === null || remaining === null || allocated === null)
		return "unknown";
	return knownStatementStatus({ remaining, allocated });
}
