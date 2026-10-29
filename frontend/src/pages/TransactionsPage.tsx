import type { EditorTarget } from "../domain/accountEdits.ts";
import { AccountSections } from "./accounts/AccountSections.tsx";

/**
 * Transactions section of the account workspace. Thin wrapper over
 * `AccountSections view="transactions"`; row-hook migration pending — still
 * requires the `Plan` draft layer.
 */
export function TransactionsPage({
	onEdit,
	onAccount,
}: {
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	return (
		<AccountSections view="transactions" onEdit={onEdit} onAccount={onAccount} />
	);
}
