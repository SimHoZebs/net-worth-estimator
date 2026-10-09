import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { EvaluationEvidence } from "./evidence/EvaluationEvidence.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { PositionEvidence } from "./evidence/PositionEvidence.tsx";
import { TimingEvidence } from "./evidence/TimingEvidence.tsx";
import "./evidence/evidence.css";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "evaluation"; id: string }
	| { kind: "timing" };

export function EvidenceDialog({
	target,
	plan,
	projection,
	range,
	temporary = false,
	onClose,
	onEdit,
}: {
	target: EvidenceTarget;
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	temporary?: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	const edit = (next: EditorTarget) => {
		onClose();
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
					failure={projection.firstFailure}
					onClose={onClose}
					onEdit={edit}
				/>
			);
		case "timing":
			return (
				<TimingEvidence plan={plan} projection={projection} onClose={onClose} />
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
