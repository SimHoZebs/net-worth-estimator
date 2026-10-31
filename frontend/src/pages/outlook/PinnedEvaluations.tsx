import { Pin } from "lucide-react";
import { useId } from "react";
import type { EvaluationResult, OtherEvaluation } from "@/domain/result.ts";
import { EvaluationCard } from "@/pages/evaluations/EvaluationCard.tsx";
import { OtherEvaluationCard } from "@/pages/evaluations/OtherEvaluationCard.tsx";
import { usePinnedEvaluations } from "@/state/pinnedEvaluations.ts";
import { useRemoteProjection } from "@/state/useRemoteProjection.ts";
import {
	useSavedAccounts,
	useSavedEvaluations,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedRows.ts";
import { useServerStatus } from "@/state/workspaceResources.ts";

type PinnedItem =
	| { kind: "evaluation"; result: EvaluationResult }
	| { kind: "other"; result: OtherEvaluation };

export function PinnedEvaluations() {
	const headingId = useId();
	// The card subscribes to its own queries; TanStack caches share the
	// Outlook forecast instead of receiving it as props.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const evaluations = useSavedEvaluations();
	const {
		ids: pinnedIds,
		toggle: togglePin,
		loading: pinsLoading,
	} = usePinnedEvaluations();
	const projectionQuery = useRemoteProjection({
		enabled: (accounts?.length ?? 0) > 0,
		years: 20,
		ranges:
			evaluations?.some((evaluation) =>
				(pinnedIds ?? []).includes(evaluation.id),
			) ?? false,
	});
	const status = useServerStatus().data;
	const base =
		projectionQuery.base instanceof Error || projectionQuery.isPlaceholderData
			? null
			: projectionQuery.base;
	const range = projectionQuery.range;
	const projection = base;
	const pending =
		projectionQuery.status === "pending" ||
		(projectionQuery.isPlaceholderData && projectionQuery.loading);
	const pinsDisabled = pinsLoading || (status?.readOnly ?? false);
	const onPinChange = (id: string) => {
		void togglePin(id);
	};
	if (!accounts || !transactions || !startDate) return null;
	// Only persisted pins select Outlook cards. Missing and unknown IDs never
	// create implicit or fallback evaluations.
	if (pending || !pinnedIds?.length || !projection) return null;
	const items: PinnedItem[] = [];
	for (const id of pinnedIds) {
		const result = projection.evaluations.find(
			(entry) => entry.evaluation.id === id,
		);
		if (result) {
			items.push({ kind: "evaluation", result });
			continue;
		}
		const other = projection.otherEvaluations.find((entry) => entry.id === id);
		if (other) items.push({ kind: "other", result: other });
	}
	if (!items.length) return null;
	return (
		<section className="mt-6" aria-labelledby={headingId}>
			<h2
				className="flex items-center gap-2 text-sm font-semibold"
				id={headingId}
			>
				<Pin size={14} aria-hidden="true" />
				Pinned evaluations
			</h2>
			{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none grids. */}
			<ul
				className="mt-3 mb-0 grid list-none grid-cols-2 items-stretch gap-6 p-0 max-lg:gap-4 max-sm:grid-cols-1"
				role="list"
			>
				{items.map((item) => {
					const id =
						item.kind === "evaluation"
							? item.result.evaluation.id
							: item.result.id;
					const pin = {
						pinned: true,
						onPinChange: () => onPinChange(id),
						disabled: pinsDisabled,
					};
					return (
						<li key={id} className="grid min-w-0">
							{item.kind === "evaluation" ? (
								<EvaluationCard
									evaluation={item.result.evaluation}
									result={item.result}
									pin={pin}
								/>
							) : (
								<OtherEvaluationCard
									item={item.result}
									pin={pin}
									projection={projection}
									range={range}
								/>
							)}
						</li>
					);
				})}
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
		</section>
	);
}
