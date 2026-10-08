import { Flag, Plus } from "lucide-react";
import { Badge, EmptyState } from "../components/ui.tsx";
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
					<Flag size={23} />
				</span>
			</div>
			<h2>{item.name}</h2>
			<p>{item.subtitle || otherTypeLabels[item.type]}</p>
			<div className="evaluation-card-outcome">
				{!item.enabled ? "Paused" : item.summary}
			</div>
			<Badge tone={tone}>
				{!item.enabled
					? "Excluded from evaluation"
					: item.status === "satisfied"
						? "Satisfied · base case"
						: item.status === "not-satisfied"
							? "Not satisfied · base case"
							: item.status === "warning"
								? "Needs attention"
								: "Indeterminate"}
			</Badge>
			<p className="section-note">
				Configured on the server model. This workspace shows the outcome;
				editing happens outside this plan.
			</p>
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
