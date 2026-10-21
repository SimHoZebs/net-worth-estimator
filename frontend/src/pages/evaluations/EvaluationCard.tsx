import { ArrowUpRight, Check, Flag, Pencil, Pin, Trash2 } from "lucide-react";
import { useId } from "react";
import type { EvaluationPin } from "../../components/evaluationCard.ts";
import {
	IconButton,
	Progress,
	Skeleton,
	Toggle,
} from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Evaluation } from "../../domain/model.ts";
import type { EvaluationResult } from "../../domain/result.ts";
import "./evaluations.css";

export type { EvaluationPin } from "../../components/evaluationCard.ts";

export function EvaluationCard({
	evaluation,
	result,
	probability,
	onEdit,
	onRemove,
	onEnabledChange,
	onEvidence,
	pending = false,
	pin = null,
}: {
	evaluation: Evaluation;
	result: Pick<EvaluationResult, "current" | "firstDate"> | undefined;
	probability: number | null;
	onEdit?: () => void;
	onRemove?: () => void;
	onEnabledChange?: (enabled: boolean) => void;
	onEvidence: () => void;
	pending?: boolean;
	pin?: EvaluationPin | null;
}) {
	const headingId = useId();
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	// Outcome slots await the projection; everything else is plan data and
	// stays live. Pending never fabricates zeros for not-yet-computed values.
	const outcomePending = evaluation.enabled && (pending || !result);
	const met = !outcomePending && result && result.current >= evaluation.target;
	const StateIcon = evaluation.enabled && met ? Check : Flag;
	return (
		<section
			className={`evaluation-card threshold-evaluation-card${evaluation.enabled ? "" : " is-excluded"}`}
			aria-labelledby={headingId}
			aria-busy={outcomePending}
		>
			<div className="threshold-evaluation-heading">
				<h2 id={headingId}>
					<StateIcon size={16} aria-hidden="true" />
					<span>{evaluation.name}</span>
				</h2>
				<div className="table-actions">
					{onPinChange && (
						<IconButton
							icon={Pin}
							label={
								pinned
									? `Unpin ${evaluation.name} from Outlook`
									: `Pin ${evaluation.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
						/>
					)}
					{onEdit && (
						<IconButton
							icon={Pencil}
							label={`Edit ${evaluation.name}`}
							onClick={onEdit}
						/>
					)}
					{onRemove && (
						<IconButton
							icon={Trash2}
							label={`Remove ${evaluation.name}`}
							onClick={onRemove}
						/>
					)}
				</div>
			</div>
			<div>
				<div className="evaluation-card-outcome type-value">
					{!evaluation.enabled ? (
						"Paused"
					) : outcomePending ? (
						<Skeleton width={140} height={28} />
					) : met ? (
						"Already reached"
					) : result?.firstDate ? (
						dateLabel(result.firstDate)
					) : (
						"Beyond this horizon"
					)}
				</div>
				<p className="section-note section-note-flush">
					{outcomePending ? (
						<Skeleton width={170} height={14} />
					) : !evaluation.enabled ? (
						"Excluded from evaluation"
					) : met ? (
						"Met at the start of this plan"
					) : result?.firstDate ? (
						"First reached in the base case"
					) : (
						"Not reached in the evaluated period"
					)}
				</p>
			</div>
			{evaluation.enabled &&
				(outcomePending ? (
					<Skeleton width="100%" height={32} />
				) : (
					result && (
						<div className="evaluation-card-progress">
							<div className="progress-label">
								<span>{money(result.current)} today</span>
								<span>{money(evaluation.target)} target</span>
							</div>
							<Progress
								value={(result.current / evaluation.target) * 100}
								label={evaluation.name}
							/>
						</div>
					)
				))}
			{probability !== null && evaluation.enabled && !outcomePending && (
				<p className="scenario-evaluation">
					Reached in <strong>{percent(probability)}</strong> of modeled
					scenarios.
				</p>
			)}
			<div className="evaluation-card-footer">
				{onEnabledChange && (
					<Toggle
						label="Enabled"
						checked={evaluation.enabled}
						onChange={onEnabledChange}
					/>
				)}
				<button
					type="button"
					className="text-button"
					disabled={!evaluation.enabled || outcomePending}
					onClick={onEvidence}
				>
					Evidence <ArrowUpRight size={15} />
				</button>
			</div>
		</section>
	);
}
