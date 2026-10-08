import { Pencil } from "lucide-react";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import type { EvaluationResult, RangeResult } from "../../domain/result.ts";
import { DetailRow } from "../DetailRow.tsx";
import { Modal } from "../ui.tsx";

export function EvaluationEvidence({
	result,
	accounts,
	range,
	onClose,
	onEdit,
}: {
	result: EvaluationResult;
	accounts: Account[];
	range: RangeResult | null;
	onClose: () => void;
	onEdit: () => void;
}) {
	return (
		<Modal
			title={result.evaluation.name}
			eyebrow="Evaluation evidence"
			onClose={onClose}
		>
			<div className="evidence-amount">
				{result.firstDate
					? result.current >= result.evaluation.target
						? "Already reached"
						: dateLabel(result.firstDate)
					: "Beyond this horizon"}
			</div>
			<p className="muted">First reached in the base case</p>
			<dl className="detail-list">
				<DetailRow label="Measure">
					{result.evaluation.kind === "net-worth"
						? "Household net worth"
						: accounts.find(
								(account) => account.id === result.evaluation.accountId,
							)?.name}
				</DetailRow>
				<DetailRow label="Target">{money(result.evaluation.target)}</DetailRow>
				<DetailRow label="At the start">{money(result.current)}</DetailRow>
				<DetailRow label="At the horizon">{money(result.final)}</DetailRow>
				<DetailRow label="Still met at horizon">
					{result.final >= result.evaluation.target ? "Yes" : "No"}
				</DetailRow>
				{range && (
					<DetailRow label="Scenarios reaching the target">
						{percent(range.evaluationSuccess[result.evaluation.id] ?? 0)} of{" "}
						{range.count}
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
					Edit evaluation
				</button>
			</div>
		</Modal>
	);
}
