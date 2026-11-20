/**
 * Contract-independent view model for applying a posted card payment to an
 * issued credit-card statement.
 *
 * The backend owns the match. A suggestion is only a question: an exact
 * remaining-balance match never applies itself. The owner applies a payment
 * explicitly, in full or in part. The adapter maps the backend contract into
 * this view model.
 */

/** Status of a statement with respect to the payments applied to it. */
export type StatementPaymentStatus =
	/** Nothing has been applied; the full statement balance is outstanding. */
	| "open"
	/** Some amount has been applied; a remaining balance is still owed. */
	| "partially-paid"
	/** The remaining balance reached zero. */
	| "paid-in-full"
	/** A billed amount or allocation total is not known, so status cannot be told. */
	| "unknown";

/** One other statement the current card payment could cover. */
export interface StatementPaymentOption {
	statementId: string;
	label: string;
	statementClose: string;
	remainingBalance: number;
}

/** Server-authoritative capabilities for a suggestion. */
export interface StatementPaymentActions {
	/** Apply an amount to the suggested statement. */
	apply: boolean;
	/** Apply less than the payment or remaining balance. */
	applyPartial: boolean;
	/** Defer the suggestion without changing any statement. */
	dismiss: boolean;
	/** Undo a previous apply or dismiss. */
	undo: boolean;
}

/** Everything the Suggestions UI needs to render one statement match. */
export interface StatementPaymentSuggestion {
	/** Stable key for the suggestion queue. */
	key: string;
	statementId: string;
	/** The exact statement close distinguishes multiple statements in a month. */
	statementLabel: string;
	accountName?: string;
	statementClose: string;
	dueDate: string | null;
	/** Amount billed for the statement, in USD. */
	statementBalance: number;
	/** Billed amount less payments applied to it, in USD. */
	remainingBalance: number;
	/** Amount already applied to this statement, in USD. */
	appliedAmount: number;
	status: StatementPaymentStatus;
	/** The posted card payment this suggestion concerns, in USD. */
	paymentAmount: number;
	/** Transfer-link evidence already known for the payment, when present. */
	evidence: string | null;
	/** Fine-grained matcher detail, shown only on request. */
	matcherDetail: string | null;
	/** Other statements offered when the server supports choosing one. */
	alternatives: StatementPaymentOption[];
	actions: StatementPaymentActions;
}

export function statementStatusLabel(status: StatementPaymentStatus): string {
	switch (status) {
		case "paid-in-full":
			return "Paid in full";
		case "partially-paid":
			return "Partially paid";
		case "open":
			return "Open";
		case "unknown":
			return "Status unknown";
	}
}

/**
 * Validate an explicit apply amount. The full amount and any smaller partial
 * amount are valid; zero, negatives, and amounts beyond what is owed or beyond
 * the payment are not. Returns a message to show, or null when valid.
 */
export function validateApplyAmount(
	raw: string,
	suggestion: StatementPaymentSuggestion,
): string | null {
	const amount = Number(raw);
	if (!raw.trim() || !Number.isFinite(amount))
		return "Enter the amount to apply in USD.";
	if (amount <= 0) return "Enter an amount greater than zero.";
	if (Math.abs(amount - Math.round(amount * 100) / 100) > 1e-9)
		return "Enter an amount to the nearest cent.";
	if (amount > suggestion.paymentAmount)
		return "The amount cannot exceed the card payment.";
	if (amount > suggestion.remainingBalance)
		return "The amount cannot exceed the remaining statement balance.";
	return null;
}

/** The largest amount one payment can apply to one statement right now. */
export function maxApplyAmount(suggestion: StatementPaymentSuggestion): number {
	return Math.min(suggestion.paymentAmount, suggestion.remainingBalance);
}

export function statementSuggestionKey(
	suggestion: StatementPaymentSuggestion,
): string {
	return `statement-${suggestion.key}`;
}
