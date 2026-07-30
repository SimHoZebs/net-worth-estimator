import type { StochasticProgress } from "@/lib/projection";

const countFormatter = new Intl.NumberFormat();

export function StochasticProgressDetails({
	progress,
	compact = false,
}: {
	progress: StochasticProgress;
	compact?: boolean;
}) {
	const phaseLabel =
		progress.phase === "preparing"
			? "Preparing simulation inputs"
			: progress.phase === "deterministic-evaluations"
				? "Evaluating deterministic baselines"
				: `${countFormatter.format(progress.completedRuns)} / ${countFormatter.format(progress.totalRuns)} Monte Carlo paths`;

	return (
		<div className={compact ? "space-y-1 type-caption" : "mt-2 space-y-2"}>
			<div className="font-medium text-foreground/80 tabular-nums">
				{phaseLabel}
			</div>
			{progress.evaluationWorkloads.map((workload) => {
				const unitsPerRun =
					progress.totalRuns > 0 ? workload.totalUnits / progress.totalRuns : 0;
				return (
					<div
						key={`${workload.type}:${workload.instanceId}`}
						className="rounded-xl border border-current/10 bg-current/[0.035] px-3 py-2"
					>
						<div className="type-label text-foreground/80">
							{workload.label}
						</div>
						<div className="mt-0.5 tabular-nums">
							{progress.phase === "stochastic-runs"
								? `${countFormatter.format(workload.completedUnits)} / ${countFormatter.format(workload.totalUnits)} ${workload.unitLabel} ${workload.unitAction}`
								: `${countFormatter.format(unitsPerRun)} ${workload.unitLabel} per path`}
						</div>
						{workload.intensiveUnitsCompleted !== undefined &&
						progress.phase === "stochastic-runs" ? (
							<div className="tabular-nums">
								{countFormatter.format(workload.intensiveUnitsCompleted)}{" "}
								{workload.intensiveUnitLabel} {workload.intensiveUnitAction}
							</div>
						) : null}
						{workload.description ? (
							<div className="mt-0.5 text-current/75">
								{workload.description}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
