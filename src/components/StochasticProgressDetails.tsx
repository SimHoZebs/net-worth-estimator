import type {
	StochasticEvaluationWorkload,
	StochasticProgress,
} from "@/lib/projection";

const countFormatter = new Intl.NumberFormat();
const obsoleteFiDescription =
	"Failed cycles stop at the first shortfall; date checks stop after the first successful";

/**
 * Single phase-label source for Monte Carlo progress. The top-level
 * controls and the per-evaluation cards both render through this (via
 * StochasticProgressDetails compact mode), so the strings never diverge.
 */
export function stochasticPhaseLabel(progress: StochasticProgress): string {
	if (progress.phase === "preparing") return "Preparing simulation inputs";
	if (progress.phase === "deterministic-evaluations")
		return "Evaluating deterministic baselines";
	return `${countFormatter.format(progress.completedRuns)} / ${countFormatter.format(progress.totalRuns)} Monte Carlo paths`;
}

/**
 * Determinate bar when a run fraction is known, indeterminate (pulsing)
 * bar during preparing phases or when the fraction is missing.
 */
export function StochasticProgressBar({
	fraction,
	label,
}: {
	fraction: number | null | undefined;
	label: string;
}) {
	const pct =
		typeof fraction === "number" && Number.isFinite(fraction)
			? Math.round(fraction * 100)
			: null;
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
			{pct !== null ? (
				<div
					role="progressbar"
					aria-label={label}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={pct}
					className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
					style={{ width: `${pct}%` }}
				/>
			) : (
				<div
					role="progressbar"
					aria-label={label}
					className="h-full w-1/3 animate-pulse rounded-full bg-primary"
				/>
			)}
		</div>
	);
}

export function StochasticProgressDetails({
	progress,
	compact = false,
	showPhase = true,
	showWorkloadLabels = true,
	showWorkloadTotals = true,
	showDescriptions = true,
	workloads = progress.evaluationWorkloads,
}: {
	progress: StochasticProgress;
	compact?: boolean;
	showPhase?: boolean;
	showWorkloadLabels?: boolean;
	showWorkloadTotals?: boolean;
	showDescriptions?: boolean;
	workloads?: StochasticEvaluationWorkload[];
}) {
	const phaseLabel = stochasticPhaseLabel(progress);

	return (
		<div className={compact ? "space-y-1 type-caption" : "mt-2 space-y-2"}>
			{showPhase ? (
				<div className="font-medium text-foreground/80 tabular-nums">
					{phaseLabel}
				</div>
			) : null}
			{workloads.map((workload) => {
				const unitsPerRun =
					progress.totalRuns > 0 ? workload.totalUnits / progress.totalRuns : 0;
				const description =
					workload.type === "financialIndependence" &&
					workload.description?.startsWith(obsoleteFiDescription)
						? undefined
						: workload.description;
				return (
					<div
						key={`${workload.type}:${workload.instanceId}`}
						className="rounded-xl border border-current/10 bg-current/[0.035] px-3 py-2"
					>
						{showWorkloadLabels ? (
							<div className="type-label text-foreground/80">
								{workload.label}
							</div>
						) : null}
						<div className="mt-0.5 tabular-nums">
							{progress.phase === "stochastic-runs"
								? `${countFormatter.format(workload.completedUnits)}${showWorkloadTotals ? ` / ${countFormatter.format(workload.totalUnits)}` : ""} ${workload.unitLabel} ${workload.unitAction}`
								: `${countFormatter.format(unitsPerRun)} ${workload.unitLabel} per path`}
						</div>
						{workload.intensiveUnitsCompleted !== undefined &&
						progress.phase === "stochastic-runs" ? (
							<div className="tabular-nums">
								{countFormatter.format(workload.intensiveUnitsCompleted)}{" "}
								{workload.intensiveUnitLabel} {workload.intensiveUnitAction}
							</div>
						) : null}
						{showDescriptions && description ? (
							<div className="mt-0.5 text-current/75">{description}</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
