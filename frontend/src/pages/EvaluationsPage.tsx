import { Flag, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button.tsx";
import { EmptyState } from "@/components/EmptyState.tsx";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import { ProjectionUpdating } from "@/components/ProjectionUpdating.tsx";
import type { Evaluation } from "@/domain/model.ts";
import { deleteEvaluation } from "@/api/generated/endpoints.ts";
import {
	summaryEvaluations,
	summaryInstanceIds,
	useEvaluationSummary,
} from "@/state/evaluationQueries.ts";
import { performSave } from "@/state/workspaceWrites.ts";
import { usePinnedEvaluations } from "@/state/pinnedEvaluations.ts";
import { useRemoteProjection } from "@/state/useRemoteProjection.ts";

import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedRows.ts";
import {
	refreshEvaluations,
	useAccountBalances,
	useServerStatus,
} from "@/state/workspaceResources.ts";
import { EvaluationCard } from "@/pages/evaluations/EvaluationCard.tsx";
import { OtherEvaluationCard } from "@/pages/evaluations/OtherEvaluationCard.tsx";

export function EvaluationsPage({
	onEdit,
}: {
	onEdit: (evaluation: Evaluation | null) => void;
}) {
	// The grid subscribes to its own queries; only UI callbacks arrive as
	// props. Saved rows arrive through the row hooks; null means not loaded.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const summary = useEvaluationSummary();
	const savedIds = useMemo(
		() => summaryInstanceIds(summary.data),
		[summary.data],
	);
	const savedEvaluations = useMemo(
		() => summaryEvaluations(summary.data),
		[summary.data],
	);
	const financialIndependenceEnabled = useMemo(
		() =>
			summary.data?.evaluations.financialIndependence.some(
				(item) => item.enabled,
			) ?? false,
		[summary.data],
	);
	const projectionQuery = useRemoteProjection({
		// Reuse the regular range request for configured financial independence
		// confidence. Inspecting dates and evidence never starts a calculation.
		ranges: savedEvaluations.length > 0 || financialIndependenceEnabled,
	});
	const base =
		projectionQuery.base instanceof Error ? null : projectionQuery.base;
	const range = projectionQuery.range;
	const projection = base;
	const pending = projection === null;
	// Other evaluation kinds are configured server-side, so their count is
	// unknowable until the projection lands; they join the grid on arrival.
	const others = projection?.otherEvaluations ?? [];
	const evaluations = savedEvaluations;
	const balances = useAccountBalances();
	const status = useServerStatus().data;
	const { ids: pinnedIds, toggle: togglePin } = usePinnedEvaluations();
	const [removeError, setRemoveError] = useState<string | null>(null);
	// Pins name persisted server instances: every grid row is a saved row,
	// so the pin control stays enabled once outcomes arrive.
	const pinsBlocked = (status?.readOnly ?? false) || pending;
	const pinnedSet = new Set(pinnedIds ?? []);
	const archivedIds = useMemo(
		() =>
			new Set(
				(balances.data?.accounts ?? [])
					.filter((account) => account.archived)
					.map((account) => account.id),
			),
		[balances.data],
	);
	const visible = evaluations.filter(
		(evaluation) =>
			!evaluation.accountId || !archivedIds.has(evaluation.accountId),
	);
	const onRemove = (evaluation: Evaluation) => {
		setRemoveError(null);
		void performSave({
			call: () => deleteEvaluation(evaluation.id),
			refresh: refreshEvaluations,
			failureMessage: "The evaluation could not be removed.",
		}).then((ok) => {
			if (!ok)
				setRemoveError(
					"The evaluation could not be removed. Review the workspace notice and try again.",
				);
		});
	};
	if (!accounts || !transactions || !startDate) return null;
	return (
		<>
			{projectionQuery.loading && projection && <ProjectionUpdating />}
			<div className="mb-6 flex items-center justify-between gap-4 max-sm:flex-wrap">
				<Button type="button" variant="primary" onClick={() => onEdit(null)}>
					<Plus size={16} />
					Add evaluation
				</Button>
			</div>
			{removeError && <ErrorNotice message={removeError} />}
			{!pending && !visible.length && !others.length && (
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
				{visible.map((evaluation) => (
					<EvaluationCard
						key={evaluation.id}
						evaluation={evaluation}
						result={projection?.evaluations.find(
							(goal) => goal.evaluation.id === evaluation.id,
						)}
						pending={pending}
						pin={{
							pinned: pinnedSet.has(evaluation.id),
							onPinChange: () => {
								void togglePin(evaluation.id);
							},
							disabled: pinsBlocked || !savedIds.has(evaluation.id),
						}}
						onEdit={() => onEdit(evaluation)}
						onRemove={() => onRemove(evaluation)}
					/>
				))}
				{others.map((item) => (
					<OtherEvaluationCard
						key={item.id}
						item={item}
						projection={projection}
						range={range}
						pin={{
							pinned: pinnedSet.has(item.id),
							onPinChange: () => {
								void togglePin(item.id);
							},
							disabled: pinsBlocked || !savedIds.has(item.id),
						}}
					/>
				))}
			</div>
		</>
	);
}
