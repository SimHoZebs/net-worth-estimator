import { ArrowRight, ArrowUpRight, Flag } from "lucide-react";
import { Progress } from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { GoalResult, RangeResult } from "../../domain/result.ts";

export function GoalPreview({
	result: goal,
	range,
	onGoals,
	onGoal,
}: {
	result: GoalResult | null;
	range: RangeResult | null;
	onGoals: () => void;
	onGoal: (id: string) => void;
}) {
	return (
		<section className="goal-preview">
			<div className="section-top">
				<h2>
					<Flag size={18} />A goal on the horizon
				</h2>
				<button type="button" className="text-button" onClick={onGoals}>
					All goals <ArrowUpRight size={16} />
				</button>
			</div>
			{goal ? (
				<>
					<div className="goal-preview-content">
						<div>
							<p>{goal.goal.name}</p>
							<div className="goal-date">
								{goal.current >= goal.goal.target
									? "Already there"
									: goal.firstDate
										? dateLabel(goal.firstDate)
										: "Beyond this horizon"}
							</div>
							<span className="muted">
								{goal.current >= goal.goal.target
									? "Met at the start of this plan"
									: "First reached in the base case"}
							</span>
						</div>
						<div className="goal-glyph" aria-hidden="true">
							<Flag size={30} strokeWidth={1.2} />
						</div>
					</div>
					<div className="progress-label">
						<span>{money(goal.current)} today</span>
						<span>{money(goal.goal.target)} goal</span>
					</div>
					<Progress
						value={(goal.current / goal.goal.target) * 100}
						label={goal.goal.name}
					/>
					<button
						type="button"
						className="goal-evidence-link text-button"
						onClick={() => onGoal(goal.goal.id)}
					>
						{range
							? `${percent(range.goalSuccess[goal.goal.id] ?? 0)} of scenarios reach this goal`
							: "See goal evidence"}{" "}
						<ArrowRight size={14} />
					</button>
				</>
			) : (
				<p className="muted">Add a goal to give your plan a destination.</p>
			)}
		</section>
	);
}
