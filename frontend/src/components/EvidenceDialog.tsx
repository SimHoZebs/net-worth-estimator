import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { EvaluationEvidence } from "./evidence/EvaluationEvidence.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { PositionEvidence } from "./evidence/PositionEvidence.tsx";
import { SafeSpendingEvidence } from "./evidence/SafeSpendingEvidence.tsx";
import "./evidence/evidence.css";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "evaluation"; id: string }
	| { kind: "safe-spending" };

export function EvidenceDialog({
	target,
	plan,
	projection,
	range,
	temporary = false,
	onClose,
	onEdit,
	onApply,
}: {
	target: EvidenceTarget;
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
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
		case "evaluation": {
			const result = projection.evaluations.find(
				(item) => item.evaluation.id === target.id,
			);
			return result ? (
				<EvaluationEvidence
					result={result}
					accounts={plan.accounts.filter((account) => !account.archived)}
					range={range}
					onClose={onClose}
					onEdit={() => edit({ kind: "evaluation", item: result.evaluation })}
				/>
			) : null;
		}
	}
}
