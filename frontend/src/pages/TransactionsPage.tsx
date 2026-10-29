import type { EditorTarget } from "../domain/accountEdits.ts";
import { PlanPage } from "./PlanPage.tsx";

/**
 * Transactions section of the account workspace. Thin wrapper over
 * `PlanPage view="transactions"`; row-hook migration pending — still
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
		<PlanPage view="transactions" onEdit={onEdit} onAccount={onAccount} />
	);
}
