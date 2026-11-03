import type { EditorTarget } from "../domain/accountEdits.ts";
import { ruleTransaction } from "../domain/accountActivity.ts";
import { todayIso } from "../domain/format.ts";
import type { Transaction } from "../domain/model.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../state/savedRows.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { TransactionDetail } from "./activity/TransactionDetail.tsx";
import { AccountEditor } from "./editors/AccountEditor.tsx";
import { EvaluationEditor } from "./editors/EvaluationEditor.tsx";
import { AddTransactionDialog } from "./editors/AddTransactionDialog.tsx";

export type { EditorTarget } from "../domain/accountEdits.ts";

/** Existing rows use the shared detail; only creation has its own form. */
function ExistingTransactionDetail({
	item,
	onClose,
}: {
	item: Transaction;
	onClose: () => void;
}) {
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	const accountList = accounts ?? [];
	const savedRows = transactions ?? [item];
	return (
		<TransactionDetail
			key={item.id}
			transaction={ruleTransaction({
				transaction: item,
				accounts: accountList,
				startDate: startDate ?? todayIso(),
			})}
			savedTransaction={item}
			accounts={accountList}
			transactions={savedRows}
			readOnly={readOnly}
			onClose={onClose}
		/>
	);
}

/**
 * Account-scoped workspace editor. Existing transactions open the shared
 * TransactionDetail; only new transactions use the create form. Each editor
 * saves straight to the server and closes only after confirmed save.
 */
export function WorkspaceEditor({
	target,
	onClose,
}: {
	target: EditorTarget;
	onClose: () => void;
}) {
	switch (target.kind) {
		case "account":
			return (
				<AccountEditor
					key={target.item?.id ?? "new-account"}
					item={target.item}
					onSaved={onClose}
					onClose={onClose}
				/>
			);
		case "transaction":
			return target.item ? (
				<ExistingTransactionDetail item={target.item} onClose={onClose} />
			) : (
				<AddTransactionDialog
					key="new-transaction"
					onSaved={onClose}
					onClose={onClose}
				/>
			);
		case "evaluation":
			return (
				<EvaluationEditor
					key={target.item?.id ?? "new-evaluation"}
					item={target.item}
					onSaved={onClose}
					onClose={onClose}
				/>
			);
	}
}
