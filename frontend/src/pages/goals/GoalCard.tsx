import { ArrowUpRight, Check, Flag, Pencil, Trash2 } from "lucide-react";
import { Badge, IconButton, Progress, Toggle } from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { Goal } from "../../domain/model.ts";
import type { GoalResult } from "../../domain/result.ts";

export function GoalCard({
	goal,
	result,
	measure,
	probability,
	onEdit,
	onRemove,
	onEnabledChange,
	onEvidence,
}: {
	goal: Goal;
	result: Pick<GoalResult, "current" | "firstDate"> | undefined;
	measure: string | undefined;
	probability: number | null;
	onEdit: () => void;
	onRemove: () => void;
	onEnabledChange: (enabled: boolean) => void;
	onEvidence: () => void;
}) {
	const met = result && result.current >= goal.target;
	return (
		<section className={`goal-card ${goal.enabled ? "" : "is-excluded"}`}>
			<div className="section-top">
				<span className="goal-icon">
					{met ? <Check size={23} /> : <Flag size={23} />}
				</span>
				<div className="table-actions">
					<IconButton
						icon={Pencil}
						label={`Edit ${goal.name}`}
						onClick={onEdit}
					/>
					<IconButton
						icon={Trash2}
						label={`Remove ${goal.name}`}
						onClick={onRemove}
					/>
				</div>
			</div>
			<h2>{goal.name}</h2>
			<p>
				{measure} · {money(goal.target)}
			</p>
			<div className="goal-card-outcome">
				{!goal.enabled
					? "Paused"
					: met
						? "Already reached"
						: result?.firstDate
							? dateLabel(result.firstDate)
							: "Beyond this horizon"}
			</div>
			<Badge tone={met ? "green" : "neutral"}>
				{!goal.enabled
					? "Excluded from evaluation"
					: met
						? "Met at the start"
						: result?.firstDate
							? "First reached · base case"
							: "Not reached · base case"}
			</Badge>
			<div className="goal-card-progress">
				<div className="progress-label">
					<span>{money(result?.current ?? 0)} today</span>
					<span>
						{Math.min(
							100,
							Math.round(((result?.current ?? 0) / goal.target) * 100),
						)}
						%
					</span>
				</div>
				<Progress
					value={((result?.current ?? 0) / goal.target) * 100}
					label={goal.name}
				/>
			</div>
			{probability !== null && goal.enabled && (
				<p className="scenario-goal">
					Reached in <strong>{percent(probability)}</strong> of modeled
					scenarios.
				</p>
			)}
			<div className="goal-card-footer">
				<Toggle
					label="Enabled"
					checked={goal.enabled}
					onChange={onEnabledChange}
				/>
				<button
					type="button"
					className="text-button"
					disabled={!goal.enabled}
					onClick={onEvidence}
				>
					Evidence <ArrowUpRight size={15} />
				</button>
			</div>
		</section>
	);
}
