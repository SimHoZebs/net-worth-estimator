import { ProjectionChart } from "../components/ProjectionChart.tsx";
import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { EvaluationPreview } from "./outlook/EvaluationPreview.tsx";
import { FundingInsight } from "./outlook/FundingInsight.tsx";
import { OutlookMetrics } from "./outlook/OutlookMetrics.tsx";
import { TimingPreview } from "./outlook/TimingPreview.tsx";
import "./outlook/outlook.css";

export function Outlook({
	plan,
	projection,
	range,
	ranges,
	setRanges,
	years,
	setYears,
	progress,
	rangeError,
	onEvidence,
	onFailure,
	onTransactions,
	onEvaluations,
	onEvaluation,
	onEdit,
}: {
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	ranges: boolean;
	setRanges: (value: boolean) => void;
	years: number;
	setYears: (value: number) => void;
	progress: number;
	rangeError: string | null;
	onEvidence: () => void;
	onFailure: () => void;
	onTransactions: () => void;
	onEvaluations: () => void;
	onEvaluation: (id: string) => void;
	onEdit: (target: EditorTarget) => void;
}) {
	if (!projection.points.length) return null;
	const evaluation =
		projection.evaluations.find(
			(result) => result.current < result.evaluation.target,
		) ?? projection.evaluations[0];
	return (
		<>
			<div className="outlook-top">
				<ProjectionChart
					plan={plan}
					projection={projection}
					range={range}
					ranges={ranges}
					setRanges={setRanges}
					years={years}
					setYears={setYears}
					progress={progress}
					rangeError={rangeError}
				/>
				<div className="outlook-rail">
					<OutlookMetrics
						plan={plan}
						projection={projection}
						years={years}
						onEvidence={onEvidence}
					/>
					<FundingInsight
						failure={projection.firstFailure}
						onFailure={onFailure}
						onPlan={onTransactions}
					/>
				</div>
			</div>
			<div className="outlook-secondary">
				<EvaluationPreview
					result={evaluation ?? null}
					range={range}
					onEvaluations={onEvaluations}
					onEvaluation={onEvaluation}
				/>
				<TimingPreview plan={plan} projection={projection} onEdit={onEdit} />
			</div>
		</>
	);
}
