import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { ErrorNotice, ProjectionUpdating, Toggle } from "../components/ui.tsx";
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
	if (projection === null)
		return (
			<OutlookSkeleton
				ranges={ranges}
				setRanges={setRanges}
				years={years}
				setYears={setYears}
			/>
		);
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

// Section-for-section mirror of the loaded layout. Horizon and range controls
// need no projection data, so they stay live; every data slot skeletonizes.
function OutlookSkeleton({
	ranges,
	setRanges,
	years,
	setYears,
}: {
	ranges: boolean;
	setRanges: (value: boolean) => void;
	years: number;
	setYears: (value: number) => void;
}) {
	return (
		<>
			<p className="sr-only" role="status">
				Loading the projection.
			</p>
			<div className="outlook-top" aria-busy="true">
				<section className="chart-card" aria-label="Net worth over time">
					<div className="section-top chart-top">
						<h2>Net worth over time</h2>
						<div
							className="segmented"
							role="toolbar"
							aria-label="Projection horizon"
						>
							{[10, 20, 30].map((year) => (
								<button
									type="button"
									key={year}
									aria-pressed={years === year}
									onClick={() => setYears(year)}
								>
									{year} years
								</button>
							))}
						</div>
					</div>
					<div className="chart-toolbar">
						<div className="chart-legend">
							<span>
								<i className="legend-line" />
								Base case
							</span>
							{ranges && (
								<span>
									<i className="legend-band" />
									80% of scenarios
								</span>
							)}
						</div>
						<Toggle label="Show range" checked={ranges} onChange={setRanges} />
					</div>
					<span
						className="skeleton"
						style={{ width: "100%", height: 220 }}
						aria-hidden="true"
					/>
				</section>
				<div className="outlook-rail">
					<span
						className="skeleton"
						style={{ width: "100%", height: 120 }}
						aria-hidden="true"
					/>
					<span
						className="skeleton"
						style={{ width: "100%", height: 90 }}
						aria-hidden="true"
					/>
				</div>
			</div>
			<div className="outlook-secondary" aria-busy="true">
				<span
					className="skeleton"
					style={{ width: "100%", height: 140 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "100%", height: 140 }}
					aria-hidden="true"
				/>
			</div>
		</>
	);
}
