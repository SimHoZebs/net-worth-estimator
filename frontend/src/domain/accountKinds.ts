import type { AccountKind } from "../api/contracts.ts";

/** Kind values an account may declare, in display order. */
export const ACCOUNT_KINDS: readonly AccountKind[] = [
	"cash",
	"investment",
	"property",
	"debt",
];

/** Plain-language labels for the account kind picker. */
export const ACCOUNT_TYPE_LABELS: Record<AccountKind, string> = {
	cash: "Cash & savings",
	investment: "Investments",
	property: "Property",
	debt: "Debt",
};
