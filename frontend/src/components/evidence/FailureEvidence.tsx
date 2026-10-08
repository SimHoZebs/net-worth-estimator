import { ArrowRight, Info, TriangleAlert } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { MovementResult } from "../../domain/result.ts";
import { DetailRow } from "../DetailRow.tsx";
import { Modal } from "../ui.tsx";

function fundingEvidence(failure: MovementResult) {
	if (failure.available === null)
		return failure.constraint ?? "Funded amount unavailable";
	if (failure.available === Infinity) return "External funding";
	return Number.isFinite(failure.available)
		? money(failure.available)
		: "Funded amount unavailable";
}

export function FailureEvidence({
	plan,
	failure,
	onClose,
	onEdit,
}: {
	plan: Plan;
	failure: MovementResult | null;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	if (!failure)
		return (
			<Modal title="All transactions funded" onClose={onClose}>
				<p>No underfunded transactions occur in this base-case horizon.</p>
			</Modal>
		);
	const movement = plan.movements.find(
		(item) => item.id === failure.movementId,
	);
	const source = plan.accounts.find((account) => account.id === failure.fromId);
	const destination = plan.accounts.find(
		(account) => account.id === failure.toId,
	);
	const sourceFloor =
		failure.constraintTypes?.includes("source-floor") ||
		failure.constraint === "Protected account balance";
	const destinationCeiling =
		failure.constraintTypes?.includes("destination-ceiling") ||
		failure.constraint === "Destination account ceiling";
	return (
		<Modal
			title={failure.name}
			eyebrow="First underfunded transaction"
			onClose={onClose}
		>
			<div className="evidence-date">
				<TriangleAlert size={18} />
				{dateLabel(failure.date, true)} · modeled outcome
			</div>
			<div className="failure-comparison">
				<div>
					<span>Requested</span>
					<strong>{money(failure.requested)}</strong>
				</div>
				<ArrowRight size={19} />
				<div>
					<span>Realized</span>
					<strong>{money(failure.realized)}</strong>
				</div>
			</div>
			<dl className="detail-list">
				<DetailRow label="Shortfall">
					{money(failure.requested - failure.realized)}
				</DetailRow>
				<DetailRow label="Funding account">
					{source?.name ?? "External income"}
				</DetailRow>
				<DetailRow
					label={
						destinationCeiling && !sourceFloor
							? "Available to receive"
							: "Funding evidence"
					}
				>
					{fundingEvidence(failure)}
				</DetailRow>
				<DetailRow label="Binding constraint">{failure.constraint}</DetailRow>
				{sourceFloor && (
					<DetailRow label="Protected balance">
						{money(source?.minBalance ?? 0)}
					</DetailRow>
				)}
				{destinationCeiling && (
					<>
						<DetailRow label="Destination account">
							{destination?.name ?? "External spending"}
						</DetailRow>
						<DetailRow label="Destination ceiling">
							{destination?.maxBalance == null
								? "No ceiling"
								: money(destination.maxBalance)}
						</DetailRow>
					</>
				)}
			</dl>
			<div className="inline-notice amber">
				<Info size={19} />
				<span>
					The unpaid amount is not automatically borrowed or rescheduled. Later
					balances include only the realized movement, so the projected
					destination does not mean the whole plan is affordable.
				</span>
			</div>
			{movement && (
				<div className="modal-actions">
					<button
						type="button"
						className="button primary"
						onClick={() => onEdit({ kind: "movement", item: movement })}
					>
						Try changing this expense <ArrowRight size={16} />
					</button>
				</div>
			)}
		</Modal>
	);
}
