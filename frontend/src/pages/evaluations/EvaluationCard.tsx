import { ArrowUpRight, Check, Flag, Pencil, Trash2 } from "lucide-react";
import { Badge, IconButton, Progress, Toggle } from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Evaluation } from "../../domain/model.ts";
import type { EvaluationResult } from "../../domain/result.ts";

export function EvaluationCard({
	evaluation,
	result,
	probability,
	onEdit,
	onRemove,
	onEnabledChange,
	onEvidence,
}: {
	evaluation: Evaluation;
	result: Pick<EvaluationResult, "current" | "firstDate"> | undefined;
	probability: number | null;
	onEdit: () => void;
	onRemove: () => void;
	onEnabledChange: (enabled: boolean) => void;
	onEvidence: () => void;
}) {
	const met = result && result.current >= evaluation.target;
	return (
		<section
			className={`evaluation-card ${evaluation.enabled ? "" : "is-excluded"}`}
		>
			<div className="section-top">
				<span className="evaluation-icon">
					{met ? <Check size={23} /> : <Flag size={23} />}
				</span>
				<div className="table-actions">
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
			<div className="evaluation-card-outcome">
				{!evaluation.enabled
					? "Paused"
					: met
						? "Already reached"
						: result?.firstDate
							? dateLabel(result.firstDate)
							: "Beyond this horizon"}
			</div>
			<Badge tone={met ? "green" : "neutral"}>
				{!evaluation.enabled
					? "Excluded from evaluation"
					: met
						? "Met at the start"
						: result?.firstDate
							? "First reached"
							: "Not reached"}
			</Badge>
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
					disabled={!evaluation.enabled}
					onClick={onEvidence}
				>
					Evidence <ArrowUpRight size={15} />
				</button>
			</div>
		</section>
	);
}
