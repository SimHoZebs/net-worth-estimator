import type { AccountKind } from "../api/contracts.ts";

/** Kind values an account may declare, in display order. */
export const ACCOUNT_KINDS: readonly AccountKind[] = [
	"cash",
	"investment",
	"property",
	"credit_card",
	"debt",
];

/** Plain-language labels for the account kind picker. */
export const ACCOUNT_TYPE_LABELS: Record<AccountKind, string> = {
	cash: "Cash & savings",
	investment: "Investments",
	property: "Property",
	credit_card: "Credit card",
	debt: "Debt",
};

/**
 * Liabilities hold money that is owed: debt and credit cards. Cash is never a
 * liability, even when overdrawn, so it stays in the cash group. Use this
 * instead of checking for a single kind whenever the rule is about what the
 * account owes rather than which product it is.
 */
export function isLiability(account: { kind: unknown }): boolean {
	return account.kind === "debt" || account.kind === "credit_card";
}
