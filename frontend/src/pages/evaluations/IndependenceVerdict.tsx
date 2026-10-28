import { dateLabel } from "@/domain/format.ts";
import { independenceHorizon } from "@/domain/financialIndependence.ts";
import type { OtherEvaluation } from "@/domain/result.ts";

/** Compact-card verdict; the inspector presents the evidence directly. */
export function IndependenceVerdict({ item }: { item: OtherEvaluation }) {
	const analysis = item.financialIndependence;
	const reached =
		analysis?.firstSelfSustainingDate ??
		(!analysis && item.status === "satisfied" ? item.outcomeDate : null);
	const tooShort = analysis ? independenceHorizon(analysis).tooShort : false;
	return (
		<div>
			<div className="type-value text-3xl font-medium leading-tight tracking-tight [overflow-wrap:anywhere]">
				{!item.enabled
					? "Paused"
					: reached
						? dateLabel(reached)
						: tooShort
							? "More horizon needed"
							: analysis?.candidates.length
								? "Not reached"
								: "Not calculated"}
			</div>
			<p className="m-0 mt-1 text-xs text-muted">
				{!item.enabled ? "Excluded from evaluation" : "Base case"}
			</p>
		</div>
	);
}
