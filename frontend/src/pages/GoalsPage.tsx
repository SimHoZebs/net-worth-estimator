import { Flag, Plus } from "lucide-react";
import { EmptyState } from "../components/ui.tsx";
import type { Goal, Plan } from "../domain/model.ts";
import { removeGoal, setGoalEnabled } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/projection.ts";
import { GoalCard } from "./goals/GoalCard.tsx";

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
				{plan.goals.map((goal) => (
					<GoalCard
						key={goal.id}
						goal={goal}
						result={projection.goals.find((g) => g.goal.id === goal.id)}
						measure={
							goal.kind === "net-worth"
								? "Household net worth"
								: plan.accounts.find((a) => a.id === goal.accountId)?.name
						}
						probability={range ? (range.goalSuccess[goal.id] ?? 0) : null}
						onEdit={() => onEdit(goal)}
						onRemove={() => onUpdate(removeGoal({ plan, id: goal.id }))}
						onEnabledChange={(enabled) =>
							onUpdate(setGoalEnabled({ plan, id: goal.id, enabled }))
						}
						onEvidence={() => onEvidence(goal.id)}
					/>
				))}
			</div>
			<p className="bottom-note">
				Goal dates mark the first time a threshold is reached. They do not
				establish retirement readiness or sustained expense coverage.
			</p>
		</>
	);
}
