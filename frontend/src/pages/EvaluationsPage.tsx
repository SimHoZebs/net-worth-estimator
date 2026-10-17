import { Check, Flag, Pin, Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
	Badge,
	EmptyState,
	ErrorNotice,
	IconButton,
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
import { usePinnedEvaluationsStore } from "../state/pinnedEvaluations.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { EvaluationCard } from "./evaluations/EvaluationCard.tsx";

function OtherEvaluationCard({
	item,
	pinned,
	onPinChange,
	pinDisabled,
}: {
	item: OtherEvaluation;
	pinned: boolean;
	onPinChange: (() => void) | null;
	pinDisabled: boolean;
}) {
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
				{onPinChange && (
					<div className="table-actions">
						<IconButton
							icon={Pin}
							label={
								pinned
									? `Unpin ${item.name} from Outlook`
									: `Pin ${item.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
						/>
					</div>
				)}
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
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const status = useWorkspaceStore((state) => state.status);
	const pinnedIds = usePinnedEvaluationsStore((state) => state.ids);
	const pinnedError = usePinnedEvaluationsStore((state) => state.error);
	const refreshPins = usePinnedEvaluationsStore((state) => state.refresh);
	const togglePin = usePinnedEvaluationsStore((state) => state.toggle);
	useEffect(() => {
		void refreshPins();
	}, [refreshPins]);
	// Pins name persisted server instances: draft-only evaluations have no
	// server row yet, so their pin control stays disabled until saved.
	const savedEvaluationIds = useMemo(() => {
		const ids = new Set<string>();
		const tables = serverDocument?.evaluations;
		if (!tables) return ids;
		for (const row of tables.financialIndependence) ids.add(row.instanceId);
		for (const row of tables.netWorthThreshold) ids.add(row.instanceId);
		for (const row of tables.accountBalance) ids.add(row.instanceId);
		for (const row of tables.postingFulfillment) ids.add(row.instanceId);
		for (const row of tables.cycleFulfillment ?? []) ids.add(row.instanceId);
		return ids;
	}, [serverDocument]);
	const pinsBlocked = (status?.readOnly ?? false) || pending;
	const pinnedSet = new Set(pinnedIds ?? []);
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
			{pinnedError && (
				<ErrorNotice
					message={pinnedError}
					action="Reload pins"
					onAction={() => refreshPins()}
				/>
			)}
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
						pinned={pinnedSet.has(evaluation.id)}
						onPinChange={() => {
							void togglePin(evaluation.id);
						}}
						pinDisabled={pinsBlocked || !savedEvaluationIds.has(evaluation.id)}
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
					<OtherEvaluationCard
						key={item.id}
						item={item}
						pinned={pinnedSet.has(item.id)}
						onPinChange={() => {
							void togglePin(item.id);
						}}
						pinDisabled={pinsBlocked || !savedEvaluationIds.has(item.id)}
					/>
				))}
			</div>
		</>
	);
}
