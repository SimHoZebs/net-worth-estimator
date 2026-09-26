import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/projection.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { GoalEvidence } from "./evidence/GoalEvidence.tsx";
import { MethodEvidence } from "./evidence/MethodEvidence.tsx";
import { PositionEvidence } from "./evidence/PositionEvidence.tsx";
import { TimingEvidence } from "./evidence/TimingEvidence.tsx";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "goal"; id: string }
	| { kind: "timing" }
	| { kind: "method" };

export function EvidenceDialog({
	target,
	plan,
	projection,
	range,
	temporary = false,
	serverMode = false,
	onClose,
	onEdit,
}: {
	target: EvidenceTarget;
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	temporary?: boolean;
	serverMode?: boolean;
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
		case "method":
			return <MethodEvidence serverMode={serverMode} onClose={onClose} />;
		case "account": {
			const account = plan.accounts.find((item) => item.id === target.id);
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
		case "goal": {
			const result = projection.goals.find(
				(item) => item.goal.id === target.id,
			);
			return result ? (
				<GoalEvidence
					result={result}
					accounts={plan.accounts}
					range={range}
					onClose={onClose}
					onEdit={() => edit({ kind: "goal", item: result.goal })}
				/>
			) : null;
		}
	}
}
