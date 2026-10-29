import type { EditorTarget } from "../domain/accountEdits.ts";
import { PlanPage } from "./PlanPage.tsx";

/**
 * Accounts section of the account workspace. Thin wrapper over
 * `PlanPage view="accounts"`; row-hook migration pending — still requires
 * the `Plan` draft layer.
 */
export function AccountsPage({
	onEdit,
	onAccount,
}: {
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	return <PlanPage view="accounts" onEdit={onEdit} onAccount={onAccount} />;
}
