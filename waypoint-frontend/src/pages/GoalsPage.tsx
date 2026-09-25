import { ArrowUpRight, Check, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import {
	Badge,
	EmptyState,
	IconButton,
	Progress,
	Toggle,
} from "../components/ui.tsx";
import { dateLabel, money, percent } from "../domain/format.ts";
import type { Goal, Plan } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/projection.ts";

export function GoalsPage({
	plan,
	projection,
	range,
	onEdit,
	onUpdate,
	onEvidence,
}: {
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	onEdit: (goal: Goal | null) => void;
	onUpdate: (plan: Plan) => boolean;
	onEvidence: (id: string) => void;
}) {
	return (
		<>
			<div className="section-top page-section-top">
				<p className="muted">Give the future a few meaningful milestones.</p>
				<button
					type="button"
					className="button primary"
					onClick={() => onEdit(null)}
				>
					<Plus size={16} />
					Add goal
				</button>
			</div>
			{!plan.goals.length && (
				<EmptyState
					icon={Flag}
					title="What are you working toward?"
					description="Set a net-worth milestone or an account balance target."
					action="Add your first goal"
					onAction={() => onEdit(null)}
				/>
			)}
			<div className="goals-grid">
				{plan.goals.map((goal) => {
					const result = projection.goals.find((g) => g.goal.id === goal.id);
					const met = result && result.current >= goal.target;
					return (
						<section
							className={`goal-card ${goal.enabled ? "" : "is-excluded"}`}
							key={goal.id}
						>
							<div className="section-top">
								<span className="goal-icon">
									{met ? <Check size={23} /> : <Flag size={23} />}
								</span>
								<div className="table-actions">
									<IconButton
										icon={Pencil}
										label={`Edit ${goal.name}`}
										onClick={() => onEdit(goal)}
									/>
									<IconButton
										icon={Trash2}
										label={`Remove ${goal.name}`}
										onClick={() =>
											onUpdate({
												...plan,
												goals: plan.goals.filter((g) => g.id !== goal.id),
											})
										}
									/>
								</div>
							</div>
							<h2>{goal.name}</h2>
							<p>
								{goal.kind === "net-worth"
									? "Household net worth"
									: plan.accounts.find((a) => a.id === goal.accountId)
											?.name}{" "}
								· {money(goal.target)}
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
							{range && goal.enabled && (
								<p className="scenario-goal">
									Reached in{" "}
									<strong>{percent(range.goalSuccess[goal.id] ?? 0)}</strong> of
									modeled scenarios.
								</p>
							)}
							<div className="goal-card-footer">
								<Toggle
									label="Enabled"
									checked={goal.enabled}
									onChange={(enabled) =>
										onUpdate({
											...plan,
											goals: plan.goals.map((g) =>
												g.id === goal.id ? { ...g, enabled } : g,
											),
										})
									}
								/>
								<button
									type="button"
									className="text-button"
									disabled={!goal.enabled}
									onClick={() => onEvidence(goal.id)}
								>
									Evidence <ArrowUpRight size={15} />
								</button>
							</div>
						</section>
					);
				})}
			</div>
			<p className="bottom-note">
				Goal dates mark the first time a threshold is reached. They do not
				establish retirement readiness or sustained expense coverage.
			</p>
		</>
	);
}
