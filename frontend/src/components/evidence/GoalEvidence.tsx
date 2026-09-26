import { Pencil } from "lucide-react";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import type { GoalResult, RangeResult } from "../../domain/projection.ts";
import { DetailRow } from "../DetailRow.tsx";
import { Modal } from "../ui.tsx";

export function GoalEvidence({
	result,
	accounts,
	range,
	onClose,
	onEdit,
}: {
	result: GoalResult;
	accounts: Account[];
	range: RangeResult | null;
	onClose: () => void;
	onEdit: () => void;
}) {
	return (
		<Modal title={result.goal.name} eyebrow="Goal evidence" onClose={onClose}>
			<div className="evidence-amount">
				{result.firstDate
					? result.current >= result.goal.target
						? "Already reached"
						: dateLabel(result.firstDate)
					: "Beyond this horizon"}
			</div>
			<p className="muted">First reached in the base case</p>
			<dl className="detail-list">
				<DetailRow label="Measure">
					{result.goal.kind === "net-worth"
						? "Household net worth"
						: accounts.find((account) => account.id === result.goal.accountId)
								?.name}
				</DetailRow>
				<DetailRow label="Target">{money(result.goal.target)}</DetailRow>
				<DetailRow label="At the start">{money(result.current)}</DetailRow>
				<DetailRow label="At the horizon">{money(result.final)}</DetailRow>
				<DetailRow label="Still met at horizon">
					{result.final >= result.goal.target ? "Yes" : "No"}
				</DetailRow>
				{range && (
					<DetailRow label="Scenarios reaching the target">
						{percent(range.goalSuccess[result.goal.id] ?? 0)} of {range.count}
					</DetailRow>
				)}
			</dl>
			<p className="section-note">
				The first crossing of a threshold is a milestone. It does not establish
				sustained spending coverage, retirement readiness, or future certainty.
			</p>
			<div className="modal-actions">
				<button type="button" className="button primary" onClick={onEdit}>
					<Pencil size={16} />
					Edit goal
				</button>
			</div>
		</Modal>
	);
}
