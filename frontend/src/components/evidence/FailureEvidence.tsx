import { TriangleAlert } from "lucide-react";
import { dateLabel } from "../../domain/format.ts";
import { failureLedger } from "../../domain/constraintSnapshot.ts";
import type { Plan } from "../../domain/model.ts";
import type { TransactionResult, Projection } from "../../domain/result.ts";
import { Modal } from "../Modal.tsx";
import { ConstraintSnapshot } from "./ConstraintSnapshot.tsx";

export function FailureEvidence({
	plan,
	projection,
	failure,
	onClose,
}: {
	plan: Plan;
	projection: Projection;
	failure: TransactionResult | null;
	onClose: () => void;
}) {
	if (!failure)
		return (
			<Modal title="All transactions funded" onClose={onClose}>
				<p>No underfunded transactions occur in this base-case horizon.</p>
			</Modal>
		);
	const ledger = failureLedger({ plan, projection, failure });
	// The table names the transaction, so the heading names the event instead
	// of repeating it.
	return (
		<Modal title="First underfunded transaction" onClose={onClose}>
			{!ledger && (
				<div className="flex items-center gap-2 text-xs text-warning-text">
					<TriangleAlert size={18} />
					{dateLabel(failure.date, true)}
				</div>
			)}
			{ledger && (
				<ConstraintSnapshot
					ledger={ledger}
					failure={failure}
					accounts={plan.accounts}
					plan={plan}
				/>
			)}
		</Modal>
	);
}
