import { Pin } from "lucide-react";
import { useId } from "react";
import type { Plan } from "../../domain/model.ts";
import type {
	EvaluationResult,
	OtherEvaluation,
	Projection,
	RangeResult,
} from "../../domain/result.ts";
import { EvaluationCard } from "../evaluations/EvaluationCard.tsx";
import { OtherEvaluationCard } from "../evaluations/OtherEvaluationCard.tsx";

type PinnedItem =
	| { kind: "evaluation"; result: EvaluationResult }
	| { kind: "other"; result: OtherEvaluation };

export function PinnedEvaluations({
	plan,
	projection,
	range,
	pinnedIds,
	pending = false,
	pinsDisabled = false,
	onPinChange,
}: {
	plan: Plan;
	projection: Projection | null;
	range: RangeResult | null;
	pinnedIds: string[] | null;
	pending?: boolean;
	pinsDisabled?: boolean;
	onPinChange: (id: string) => void;
}) {
	const headingId = useId();
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
									probability={range?.evaluationSuccess[id] ?? null}
									pin={pin}
								/>
							) : (
								<OtherEvaluationCard
									item={item.result}
									pin={pin}
									plan={plan}
									projection={projection}
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
