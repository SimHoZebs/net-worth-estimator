import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection } from "../domain/result.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { PositionEvidence } from "./evidence/PositionEvidence.tsx";
import { SafeSpendingEvidence } from "./evidence/SafeSpendingEvidence.tsx";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "safe-spending" };

export function EvidenceDialog({
	target,
	plan,
	projection,
	temporary = false,
	onClose,
	onEdit,
	onApply,
}: {
	target: EvidenceTarget;
	plan: Plan;
	projection: Projection;
	temporary?: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
	onApply: (plan: Plan) => boolean;
}) {
	// The editor replaces the evidence in the URL overlay slot, so the
	// evidence unmounts on navigation: no separate close is needed, and the
	// back button returns to this evidence.
	const edit = (next: EditorTarget) => {
		onEdit(next);
	};
	switch (target.kind) {
		case "position":
			return (
				<PositionEvidence
					plan={plan}
					projection={projection}
					onClose={onClose}
				/>
			);
		case "failure":
			return (
				<FailureEvidence
					plan={plan}
					projection={projection}
					failure={projection.firstFailure}
					onClose={onClose}
				/>
			);
		case "safe-spending":
			return (
				<SafeSpendingEvidence
					plan={plan}
					projection={projection}
					onClose={onClose}
				/>
			);
		case "account": {
			const account = plan.accounts.find(
				(item) => item.id === target.id && !item.archived,
			);
			return account ? (
				<AccountDialog
					key={account.id}
					account={account}
					plan={plan}
					projection={projection}
					temporary={temporary}
					onClose={onClose}
					onEdit={edit}
					onApply={onApply}
				/>
			) : null;
		}
	}
}
