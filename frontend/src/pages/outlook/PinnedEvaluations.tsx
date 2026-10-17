import { ArrowRight, Pin } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type {
	EvaluationResult,
	OtherEvaluation,
	Projection,
} from "../../domain/result.ts";

type PinnedItem =
	| { kind: "evaluation"; result: EvaluationResult }
	| { kind: "other"; result: OtherEvaluation };

export function PinnedEvaluations({
	projection,
	pinnedIds,
	pending = false,
	onEvaluation,
}: {
	projection: Projection | null;
	pinnedIds: string[] | null;
	pending?: boolean;
	onEvaluation: (id: string) => void;
}) {
	// Pins resolve against the live projection: a null list means pins have
	// not loaded yet, and unknown IDs (draft-local churn) never render.
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
		<section className="pinned-evaluations" aria-label="Pinned evaluations">
			<div className="section-top">
				<span className="pinned-heading">
					<Pin size={14} aria-hidden="true" />
					Pinned evaluations
				</span>
			</div>
			<ul>
				{items.map((item) =>
					item.kind === "evaluation" ? (
						<li key={item.result.evaluation.id}>
							<div>
								<strong>{item.result.evaluation.name}</strong>
								<span className="muted">
									{item.result.current >= item.result.evaluation.target
										? `Already there · ${money(item.result.current)} today`
										: item.result.firstDate
											? `First reached ${dateLabel(item.result.firstDate)}`
											: "Beyond this horizon"}
								</span>
							</div>
							<button
								type="button"
								className="evaluation-evidence-link text-button"
								onClick={() => onEvaluation(item.result.evaluation.id)}
							>
								Evidence <ArrowRight size={14} />
							</button>
						</li>
					) : (
						<li key={item.result.id}>
							<div>
								<strong>{item.result.name}</strong>
								<span className="muted">
									{item.result.outcomeDate
										? dateLabel(item.result.outcomeDate)
										: item.result.outcomeText}
								</span>
							</div>
							<button
								type="button"
								className="evaluation-evidence-link text-button"
								onClick={() => onEvaluation(item.result.id)}
							>
								Evidence <ArrowRight size={14} />
							</button>
						</li>
					),
				)}
			</ul>
		</section>
	);
}
