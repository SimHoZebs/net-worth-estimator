import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { ErrorNotice, ProjectionUpdating } from "../components/ui.tsx";
import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { EvaluationPreview } from "./outlook/EvaluationPreview.tsx";
import { FundingInsight } from "./outlook/FundingInsight.tsx";
import { OutlookMetrics } from "./outlook/OutlookMetrics.tsx";
import { TimingPreview } from "./outlook/TimingPreview.tsx";
import "./outlook/outlook.css";

export function Outlook({
	onEvidence,
	onFailure,
	onTransactions,
	onEvaluations,
	onEvaluation,
	onEdit,
}: {
	onEvidence: () => void;
	onFailure: () => void;
	onTransactions: () => void;
	onEvaluations: () => void;
	onEvaluation: (id: string) => void;
	onEdit: (target: EditorTarget) => void;
}) {
	// Every data input subscribes where the query is declared; only UI
	// callbacks arrive as props.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const years = useUiStore((state) => state.years);
	const setYears = useUiStore((state) => state.setYears);
	const ranges = useUiStore((state) => state.ranges);
	const setRanges = useUiStore((state) => state.setRanges);
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
			<OutlookContent
				plan={plan}
				projection={base}
				pending={base === null}
				range={projection.range}
				ranges={ranges}
				setRanges={setRanges}
				years={years}
				setYears={setYears}
				progress={projection.progress}
				rangeError={projection.rangeError}
				onEvidence={onEvidence}
				onFailure={onFailure}
				onTransactions={onTransactions}
				onEvaluations={onEvaluations}
				onEvaluation={onEvaluation}
				onEdit={onEdit}
			/>
		</>
	);
}

function OutlookContent({
	plan,
	projection,
	pending,
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
	projection: Projection | null;
	pending: boolean;
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
	if (projection === null && !pending) return null;
	const evaluation =
		projection?.evaluations.find(
			(result) => result.current < result.evaluation.target,
		) ??
		projection?.evaluations[0] ??
		null;
	return (
		<>
			{pending && (
				<p className="sr-only" role="status">
					Loading the projection.
				</p>
			)}
			<div className="outlook-top" aria-busy={pending}>
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
					pending={pending}
				/>
				<div className="outlook-rail">
					<OutlookMetrics
						plan={plan}
						projection={projection}
						years={years}
						onEvidence={onEvidence}
						pending={pending}
					/>
					<FundingInsight
						failure={projection?.firstFailure ?? null}
						onFailure={onFailure}
						onPlan={onTransactions}
						pending={pending}
					/>
				</div>
			</div>
			<div className="outlook-secondary" aria-busy={pending}>
				<EvaluationPreview
					result={evaluation ?? null}
					range={range}
					onEvaluations={onEvaluations}
					onEvaluation={onEvaluation}
					pending={pending}
				/>
				<TimingPreview
					plan={plan}
					projection={projection}
					onEdit={onEdit}
					pending={pending}
				/>
			</div>
		</>
	);
}
