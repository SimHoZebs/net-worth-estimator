import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, formatElapsedTime, pct } from "@/lib/format";
import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticProjectionResult,
} from "@/lib/projection";

interface OverviewCardProps {
	result: ProjectionResult;
	projectionSettings: ProjectionRuntimeSettings;
	stochasticResult?: StochasticProjectionResult | null;
	blockerValue: string;
	blockerDetail: string;
	goalReached: boolean;
}

export const OverviewCard = memo(function OverviewCard({
	result,
	projectionSettings,
	stochasticResult,
	blockerValue,
	blockerDetail,
	goalReached,
}: OverviewCardProps) {
	const hasStochasticData =
		stochasticResult !== undefined && stochasticResult !== null;
	const current = result.summary.currentNetWorth;
	const target = projectionSettings.targetNetWorth;
	const final = result.summary.finalNetWorth;
	const hitDate = result.milestones.hitTargetDate;
	const latestDate =
		result.timeline.rows[result.timeline.rows.length - 1]?.date ??
		result.milestones.projectionStartDate;

	return (
		<Card className="rounded-[1.8rem] border-primary-border/45 bg-gradient-to-br from-card/96 via-card/90 to-primary-subtle/35">
			<CardContent className="p-5 md:p-6">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">Current net worth</div>
						<div className="mt-1 type-metric text-foreground">
							{currency.format(current)}
						</div>
						<div className="type-muted">
							as of{" "}
							{formatDate(
								result.milestones.latestHistoricalDate ??
									result.milestones.projectionStartDate,
							)}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">Time to target</div>
						<div className="mt-1 type-metric text-foreground">
							{hasStochasticData &&
							stochasticResult?.milestones.medianHitTargetDate
								? formatElapsedTime(
										result.milestones.projectionStartDate,
										stochasticResult.milestones.medianHitTargetDate,
									)
								: hitDate
									? formatElapsedTime(
											result.milestones.projectionStartDate,
											hitDate,
										)
									: "Beyond horizon"}
						</div>
						<div className="type-muted">
							{hasStochasticData &&
							stochasticResult?.milestones.medianHitTargetDate
								? `Median target date: ${formatDate(stochasticResult.milestones.medianHitTargetDate)}`
								: hitDate
									? `Target date: ${formatDate(hitDate)}`
									: `Misses by ${currency.format(Math.abs(target - final))}`}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">Confidence</div>
						<div className="mt-1 type-metric text-primary">
							{hasStochasticData && stochasticResult
								? pct.format(stochasticResult.milestones.hitTargetProbability)
								: goalReached
									? "On track"
									: "Off track"}
						</div>
						<div className="type-muted">
							{hasStochasticData && stochasticResult
								? "of simulated paths reached target"
								: goalReached
									? "Target reached within horizon"
									: "Target not reached within horizon"}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">Main constraint</div>
						<div className="mt-1 type-title">{blockerValue}</div>
						<div className="type-muted line-clamp-2">{blockerDetail}</div>
					</div>
				</div>

				<div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-4 type-muted">
					<span>
						Projected final:{" "}
						<span className="type-value">{currency.format(final)}</span> on{" "}
						{formatDate(latestDate)}
					</span>
					<span>
						Horizon:{" "}
						<span className="type-value">
							{projectionSettings.horizonYears} years
						</span>
					</span>
					{hasStochasticData &&
					stochasticResult?.milestones.worstCaseHitTargetDate ? (
						<span>
							Conservative date:{" "}
							<span className="type-value">
								{formatDate(stochasticResult.milestones.worstCaseHitTargetDate)}
							</span>
						</span>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
});
