import type { Account, Transaction } from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import type { Projection } from "../domain/result.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { SafeSpendingEvidence } from "./evidence/SafeSpendingEvidence.tsx";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "safe-spending" };

export function EvidenceDialog({
	target,
	accounts,
	transactions,
	startDate,
	readOnly,
	projection,
	temporary = false,
	onClose,
	onEdit,
}: {
	target: Exclude<EvidenceTarget, { kind: "position" }>;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	projection: Projection;
	temporary?: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	// The editor replaces the evidence in the URL overlay slot, so the
	// evidence unmounts on navigation: no separate close is needed, and the
	// back button returns to this evidence.
	const edit = (next: EditorTarget) => {
		onEdit(next);
	};
	switch (target.kind) {
		case "failure":
			return (
				<FailureEvidence
					accounts={accounts}
					transactions={transactions}
					startDate={startDate}
					readOnly={readOnly}
					projection={projection}
					failure={projection.firstFailure}
					onClose={onClose}
				/>
			);
		case "safe-spending":
			return (
				<SafeSpendingEvidence
					startDate={startDate}
					projection={projection}
					onClose={onClose}
				/>
			);
		case "account": {
			const account = accounts.find(
				(item) => item.id === target.id && !item.archived,
			);
			return account ? (
				<AccountDialog
					key={account.id}
					account={account}
					accounts={accounts}
					transactions={transactions}
					startDate={startDate}
					projection={projection}
					readOnly={readOnly}
					temporary={temporary}
					onClose={onClose}
					onEdit={edit}
				/>
			) : null;
		}
	}
}
