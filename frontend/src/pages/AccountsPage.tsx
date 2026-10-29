import type { EditorTarget } from "../domain/accountEdits.ts";
import { AccountSections } from "./accounts/AccountSections.tsx";

/**
 * Accounts section of the account workspace. Thin wrapper over
 * `AccountSections view="accounts"`; row-hook migration pending — still requires
 * the `Plan` draft layer.
 */
export function AccountsPage({
	onEdit,
	onAccount,
}: {
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	return <AccountSections view="accounts" onEdit={onEdit} onAccount={onAccount} />;
}
