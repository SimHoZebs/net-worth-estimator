import { Check, Flag, Plus } from "lucide-react";
import {
	Badge,
	EmptyState,
	ErrorNotice,
	Progress,
	ProjectionUpdating,
} from "../components/ui.tsx";
import "./evaluations/evaluations.css";
import { dateLabel } from "../domain/format.ts";
import type { Evaluation, Plan } from "../domain/model.ts";
import { removeEvaluation, setEvaluationEnabled } from "../domain/planEdits.ts";
import type {
	OtherEvaluation,
	Projection,
	RangeResult,
} from "../domain/result.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { EvaluationCard } from "./evaluations/EvaluationCard.tsx";

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
			{item.goal && item.goal !== item.name && <p>{item.goal}</p>}
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
	onEdit,
	onEvidence,
}: {
	onEdit: (evaluation: Evaluation | null) => void;
	onEvidence: (id: string) => void;
}) {
	// Plan, actions, and projection subscribe where the query is declared;
	// only UI callbacks arrive as props.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const onUpdate = useWorkspaceStore((state) => state.updatePlan);
	const ranges = useUiStore((state) => state.ranges);
	const projection = useRemoteProjection();
	if (!plan) return null;
	const baseLoadError =
		projection.base instanceof Error && !projection.loading
			? projection.base
			: null;
	const base: Projection | null =
		projection.base instanceof Error ? null : projection.base;
	return (
		<>
			{baseLoadError && (
				<ErrorNotice
					message={baseLoadError.message}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.baseError && base && (
				<ErrorNotice
					message={projection.baseError}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.rangeError && ranges && (
				<ErrorNotice
					message={projection.rangeError}
					action="Retry scenario calculation"
					onAction={projection.retryRange}
				/>
			)}
			{projection.loading && base && <ProjectionUpdating />}
			<EvaluationsContent
				plan={plan}
				projection={base}
				range={projection.range}
				onEdit={onEdit}
				onUpdate={onUpdate}
				onEvidence={onEvidence}
			/>
		</>
	);
}

function EvaluationsContent({
	plan,
	projection,
	range,
	onEdit,
	onUpdate,
	onEvidence,
}: {
	plan: Plan;
	projection: Projection | null;
	range: RangeResult | null;
	onEdit: (evaluation: Evaluation | null) => void;
	onUpdate: (plan: Plan) => boolean;
	onEvidence: (id: string) => void;
}) {
	const pending = projection === null;
	// Other evaluation kinds are configured server-side, so their count is
	// unknowable until the projection lands; they join the grid on arrival.
	const others = projection?.otherEvaluations ?? [];
	const archivedIds = new Set(
		plan.accounts.filter((a) => a.archived).map((a) => a.id),
	);
	const evaluations = plan.evaluations.filter(
		(evaluation) =>
			!evaluation.accountId || !archivedIds.has(evaluation.accountId),
	);
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
			{!pending && !evaluations.length && !others.length && (
				<EmptyState icon={Flag} title="What are you working toward?" />
			)}
			{pending && (
				<p className="sr-only" role="status">
					Loading evaluation outcomes.
				</p>
			)}
			<div className="evaluations-grid" aria-busy={pending}>
				{evaluations.map((evaluation) => (
					<EvaluationCard
						key={evaluation.id}
						evaluation={evaluation}
						result={projection?.evaluations.find(
							(g) => g.evaluation.id === evaluation.id,
						)}
						probability={
							projection && range
								? (range.evaluationSuccess[evaluation.id] ?? 0)
								: null
						}
						pending={pending}
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
		</>
	);
}
