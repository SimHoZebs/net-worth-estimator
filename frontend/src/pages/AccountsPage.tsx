import { AccountSections } from "./accounts/AccountSections.tsx";

/**
 * Accounts section of the account workspace. Thin wrapper over
 * `AccountSections view="accounts"`; row-hook migration pending — still requires
 * saved row queries.
 */
export function AccountsPage() {
	return <AccountSections view="accounts" />;
}
