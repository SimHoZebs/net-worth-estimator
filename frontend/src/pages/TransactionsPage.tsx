import { AccountSections } from "./accounts/AccountSections.tsx";

/**
 * Transactions section of the account workspace. Thin wrapper over
 * `AccountSections view="transactions"`; row-hook migration pending — still
 * reads saved row queries.
 */
export function TransactionsPage() {
	return <AccountSections view="transactions" />;
}
