import { Check, Flag, Plus } from "lucide-react";
import { Badge, EmptyState, Progress } from "../components/ui.tsx";
import { dateLabel } from "../domain/format.ts";
import type { Evaluation, Plan } from "../domain/model.ts";
import { removeEvaluation, setEvaluationEnabled } from "../domain/planEdits.ts";
import type {
	OtherEvaluation,
	Projection,
	RangeResult,
} from "../domain/result.ts";
import { EvaluationCard } from "./evaluations/EvaluationCard.tsx";

const otherTypeLabels: Record<OtherEvaluation["type"], string> = {
	financialIndependence: "Financial independence",
	postingFulfillment: "Posting fulfillment",
	cycleFulfillment: "Cycle fulfillment",
};

function OtherEvaluationCard({ item }: { item: OtherEvaluation }) {
	const satisfied = item.enabled && item.status === "satisfied";
	const tone =
		!item.enabled || item.status === "indeterminate"
			? "neutral"
			: item.status === "satisfied"
				? "green"
				: item.status === "warning"
					? "amber"
					: "neutral";
	return (
		<section className={`evaluation-card ${item.enabled ? "" : "is-excluded"}`}>
			<div className="section-top">
				<span className="evaluation-icon">
					{satisfied ? <Check size={23} /> : <Flag size={23} />}
				</span>
			</div>
			<h2>{item.name}</h2>
			<p>{item.goal || otherTypeLabels[item.type]}</p>
			<div className="evaluation-card-outcome">
				{!item.enabled
					? "Paused"
					: item.outcomeDate
						? dateLabel(item.outcomeDate)
						: item.outcomeText}
			</div>
			{item.enabled && item.qualifier && (
				<p className="section-note">{item.qualifier}</p>
			)}
			<Badge tone={tone}>
				{!item.enabled
					? "Excluded from evaluation"
					: item.status === "satisfied"
						? "Satisfied"
						: item.status === "not-satisfied"
							? "Not satisfied"
							: item.status === "warning"
								? "Needs attention"
								: "Indeterminate"}
			</Badge>
			{item.enabled && item.progress && (
				<div className="evaluation-card-progress">
					<div className="progress-label">
						<span>{item.progress.current}</span>
						{item.progress.share && <span>{item.progress.share}</span>}
					</div>
					<Progress value={item.progress.fraction * 100} label={item.name} />
				</div>
			)}
		</section>
	);
}

export function EvaluationsPage({
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
	onEdit: (evaluation: Evaluation | null) => void;
	onUpdate: (plan: Plan) => boolean;
	onEvidence: (id: string) => void;
}) {
	const others = projection.otherEvaluations;
	return (
		<>
			<div className="section-top page-section-top">
				<button
					type="button"
					className="button primary"
					onClick={() => onEdit(null)}
				>
					<Plus size={16} />
					Add evaluation
				</button>
			</div>
			{!plan.evaluations.length && !others.length && (
				<EmptyState
					icon={Flag}
					title="What are you working toward?"
					description="Set a net-worth milestone or an account balance target."
					action="Add your first evaluation"
					onAction={() => onEdit(null)}
				/>
			)}
			<div className="evaluations-grid">
				{plan.evaluations.map((evaluation) => (
					<EvaluationCard
						key={evaluation.id}
						evaluation={evaluation}
						result={projection.evaluations.find(
							(g) => g.evaluation.id === evaluation.id,
						)}
						measure={
							evaluation.kind === "net-worth"
								? "Household net worth"
								: plan.accounts.find((a) => a.id === evaluation.accountId)?.name
						}
						probability={
							range ? (range.evaluationSuccess[evaluation.id] ?? 0) : null
						}
						onEdit={() => onEdit(evaluation)}
						onRemove={() =>
							onUpdate(removeEvaluation({ plan, id: evaluation.id }))
						}
						onEnabledChange={(enabled) =>
							onUpdate(
								setEvaluationEnabled({ plan, id: evaluation.id, enabled }),
							)
						}
						onEvidence={() => onEvidence(evaluation.id)}
					/>
				))}
				{others.map((item) => (
					<OtherEvaluationCard key={item.id} item={item} />
				))}
			</div>
			<p className="bottom-note">
				Evaluation dates mark the first time a threshold is reached. They do not
				establish retirement readiness or sustained expense coverage.
			</p>
		</>
	);
}
