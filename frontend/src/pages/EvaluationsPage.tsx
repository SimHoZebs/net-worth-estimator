import { Flag, Plus } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/Button.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { ProjectionUpdating } from "@/components/ProjectionUpdating.tsx";
import type { Evaluation, Plan } from "@/domain/model.ts";
import { removeEvaluation } from "@/domain/planEdits.ts";
import type { Projection, RangeResult } from "@/domain/result.ts";
import { usePinnedEvaluations } from "@/state/pinnedEvaluations.ts";
import { useRemoteProjection } from "@/state/useRemoteProjection.ts";
import { useWorkspaceStore } from "@/state/workspaceStore.ts";
import { usePlan } from "@/state/useWorkspacePlan.ts";
import { useServerModel, useServerStatus } from "@/state/workspaceResources.ts";
import { EvaluationCard } from "@/pages/evaluations/EvaluationCard.tsx";
import { OtherEvaluationCard } from "@/pages/evaluations/OtherEvaluationCard.tsx";

export function EvaluationsPage({
	onEdit,
}: {
	onEdit: (evaluation: Evaluation | null) => void;
}) {
	// Plan, actions, and projection subscribe where the query is declared;
	// only UI callbacks arrive as props.
	const plan = usePlan();
	const onUpdate = useWorkspaceStore((state) => state.updatePlan);
	const projection = useRemoteProjection({
		// The stochastic range only feeds threshold-card probabilities, so
		// it is requested only while a threshold evaluation is configured.
		ranges: (plan?.evaluations.length ?? 0) > 0,
	});
	const base = projection.base instanceof Error ? null : projection.base;
	if (!plan) return null;
	return (
		<>
			{projection.loading && base && <ProjectionUpdating />}
			<EvaluationsContent
				plan={plan}
				projection={base}
				range={projection.range}
				onEdit={onEdit}
				onUpdate={onUpdate}
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
}: {
	plan: Plan;
	projection: Projection | null;
	range: RangeResult | null;
	onEdit: (evaluation: Evaluation | null) => void;
	onUpdate: (plan: Plan) => boolean;
}) {
	const pending = projection === null;
	// Other evaluation kinds are configured server-side, so their count is
	// unknowable until the projection lands; they join the grid on arrival.
	const others = projection?.otherEvaluations ?? [];
	const serverDocument = useServerModel().data?.document;
	const status = useServerStatus().data;
	const { ids: pinnedIds, toggle: togglePin } = usePinnedEvaluations();
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
			<div className="mb-6 flex items-center justify-between gap-4 max-sm:flex-wrap">
				<Button type="button" variant="primary" onClick={() => onEdit(null)}>
					<Plus size={16} />
					Add evaluation
				</Button>
			</div>
			{!pending && !evaluations.length && !others.length && (
				<EmptyState icon={Flag} title="What are you working toward?" />
			)}
			{pending && (
				<p className="sr-only" role="status">
					Loading evaluation outcomes.
				</p>
			)}
			<div
				className="grid grid-cols-2 items-stretch gap-6 max-lg:gap-4 max-sm:grid-cols-1"
				aria-busy={pending}
			>
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
						pin={{
							pinned: pinnedSet.has(evaluation.id),
							onPinChange: () => {
								void togglePin(evaluation.id);
							},
							disabled: pinsBlocked || !savedEvaluationIds.has(evaluation.id),
						}}
						onEdit={() => onEdit(evaluation)}
						onRemove={() =>
							onUpdate(removeEvaluation({ plan, id: evaluation.id }))
						}
					/>
				))}
				{others.map((item) => (
					<OtherEvaluationCard
						key={item.id}
						item={item}
						plan={plan}
						projection={projection}
						pin={{
							pinned: pinnedSet.has(item.id),
							onPinChange: () => {
								void togglePin(item.id);
							},
							disabled: pinsBlocked || !savedEvaluationIds.has(item.id),
						}}
					/>
				))}
			</div>
		</>
	);
}
