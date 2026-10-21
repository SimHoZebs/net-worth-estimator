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
	onEvaluation,
}: {
	plan: Plan;
	projection: Projection | null;
	range: RangeResult | null;
	pinnedIds: string[] | null;
	pending?: boolean;
	pinsDisabled?: boolean;
	onPinChange: (id: string) => void;
	onEvaluation: (id: string) => void;
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
		<section className="pinned-evaluations" aria-labelledby={headingId}>
			<h2 className="pinned-heading" id={headingId}>
				<Pin size={14} aria-hidden="true" />
				Pinned evaluations
			</h2>
			{/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none grids. */}
			<ul className="evaluations-grid" role="list">
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
						<li key={id}>
							{item.kind === "evaluation" ? (
								<EvaluationCard
									evaluation={item.result.evaluation}
									result={item.result}
									probability={range?.evaluationSuccess[id] ?? null}
									onEvidence={() => onEvaluation(id)}
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
		</section>
	);
}
