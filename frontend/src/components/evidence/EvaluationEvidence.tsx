import { Pencil } from "lucide-react";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import type { EvaluationResult, RangeResult } from "../../domain/result.ts";
import { Button } from "../Button.tsx";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
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
			<div className="type-value mb-2 text-4xl leading-[1.2] font-medium tracking-[-1px]">
				{result.firstDate
					? result.current >= result.evaluation.target
						? "Already reached"
						: dateLabel(result.firstDate)
					: "Beyond this horizon"}
			</div>
			<p className="text-muted">First reached in the base case</p>
			<DetailList>
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
			</DetailList>
			<p className="py-2 text-sm leading-relaxed text-muted">
				The first crossing of a threshold is a milestone. It does not establish
				sustained spending coverage, retirement readiness, or future certainty.
			</p>
			<div className={dialogActionsStyles}>
				<Button type="button" variant="primary" onClick={onEdit}>
					<Pencil size={16} />
					Edit evaluation
				</Button>
			</div>
		</Modal>
	);
}
