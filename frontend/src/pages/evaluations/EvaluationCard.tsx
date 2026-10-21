import { ArrowUpRight, Check, Flag, Pencil, Pin, Trash2 } from "lucide-react";
import {
	Badge,
	IconButton,
	Progress,
	Skeleton,
	Toggle,
} from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Evaluation } from "../../domain/model.ts";
import type { EvaluationResult } from "../../domain/result.ts";

export type EvaluationPin = {
	pinned: boolean;
	onPinChange: (() => void) | null;
	disabled?: boolean;
};

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
	onEdit: () => void;
	onRemove: () => void;
	onEnabledChange: (enabled: boolean) => void;
	onEvidence: () => void;
	pending?: boolean;
	pin?: EvaluationPin | null;
}) {
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	const met = result && result.current >= evaluation.target;
	// Outcome slots await the projection; everything else is plan data and
	// stays live. Pending never fabricates zeros for not-yet-computed values.
	const outcomePending = pending && evaluation.enabled;
	return (
		<section
			className={`evaluation-card ${evaluation.enabled ? "" : "is-excluded"}`}
		>
			<div className="section-top">
				<span className="evaluation-icon">
					{met ? <Check size={23} /> : <Flag size={23} />}
				</span>
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
					<IconButton
						icon={Pencil}
						label={`Edit ${evaluation.name}`}
						onClick={onEdit}
					/>
					<IconButton
						icon={Trash2}
						label={`Remove ${evaluation.name}`}
						onClick={onRemove}
					/>
				</div>
			</div>
			<h2>{evaluation.name}</h2>
			<div className="evaluation-card-outcome type-value">
				{!evaluation.enabled ? (
					"Paused"
				) : outcomePending ? (
					<Skeleton width={140} height={16} />
				) : met ? (
					"Already reached"
				) : result?.firstDate ? (
					dateLabel(result.firstDate)
				) : (
					"Beyond this horizon"
				)}
			</div>
			{outcomePending ? (
				<Skeleton width={110} height={20} />
			) : (
				<Badge tone={met ? "green" : "neutral"}>
					{!evaluation.enabled
						? "Excluded from evaluation"
						: met
							? "Met at the start"
							: result?.firstDate
								? "First reached"
								: "Not reached"}
				</Badge>
			)}
			{outcomePending ? (
				<Skeleton width={"100%"} height={44} />
			) : (
				<div className="evaluation-card-progress">
					<div className="progress-label">
						<span>{money(result?.current ?? 0)} today</span>
						<span>
							{Math.min(
								100,
								Math.round(((result?.current ?? 0) / evaluation.target) * 100),
							)}
							%
						</span>
					</div>
					<Progress
						value={((result?.current ?? 0) / evaluation.target) * 100}
						label={evaluation.name}
					/>
				</div>
			)}
			{probability !== null && evaluation.enabled && (
				<p className="scenario-evaluation">
					Reached in <strong>{percent(probability)}</strong> of modeled
					scenarios.
				</p>
			)}
			<div className="evaluation-card-footer">
				<Toggle
					label="Enabled"
					checked={evaluation.enabled}
					onChange={onEnabledChange}
				/>
				<button
					type="button"
					className="text-button"
					disabled={!evaluation.enabled || pending}
					onClick={onEvidence}
				>
					Evidence <ArrowUpRight size={15} />
				</button>
			</div>
		</section>
	);
}
