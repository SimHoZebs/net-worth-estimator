import { memo } from "react";
import { Card, CardContent} from "@/components/ui/card";
import { currency, formatDate, formatElapsedTime, pct } from "@/lib/format";
import type { ProjectionResult, StochasticProjectionResult, ProjectionRuntimeSettings } from "@/lib/projection";

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
  const hasStochasticData = stochasticResult !== undefined && stochasticResult !== null;
  const current = result.summary.currentNetWorth;
  const target = projectionSettings.targetNetWorth;
  const final = result.summary.finalNetWorth;
  const hitDate = result.milestones.hitTargetDate;
  const latestDate = result.timeline.rows[result.timeline.rows.length - 1]?.date ?? result.milestones.projectionStartDate;

  return (
    <Card className="rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardContent className="p-5 md:p-6">
        <div className="flex gap-6 lg:justify-evenly">
          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Current net worth</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{currency.format(current)}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">as of {formatDate(result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate)}</div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Time to target</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {hasStochasticData && stochasticResult?.milestones.medianHitTargetDate
                ? formatElapsedTime(result.milestones.projectionStartDate, stochasticResult.milestones.medianHitTargetDate)
                : hitDate
                  ? formatElapsedTime(result.milestones.projectionStartDate, hitDate)
                  : "Beyond horizon"}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {hasStochasticData && stochasticResult?.milestones.medianHitTargetDate
                ? `Median target date: ${formatDate(stochasticResult.milestones.medianHitTargetDate)}`
                : hitDate
                  ? `Target date: ${formatDate(hitDate)}`
                  : `Misses by ${currency.format(Math.abs(target - final))}`}
            </div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Confidence</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {hasStochasticData && stochasticResult
                ? pct.format(stochasticResult.milestones.hitTargetProbability)
                : goalReached ? "On track" : "Off track"}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {hasStochasticData && stochasticResult
                ? "of simulated paths reached target"
                : goalReached
                  ? "Target reached within horizon"
                  : "Target not reached within horizon"}
            </div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Main constraint</div>
            <div className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{blockerValue}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{blockerDetail}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 dark:border-slate-700 pt-4 text-sm text-slate-600 dark:text-slate-400">
          <span>Projected final: <span className="font-medium text-slate-900 dark:text-slate-100">{currency.format(final)}</span> on {formatDate(latestDate)}</span>
          <span>Horizon: <span className="font-medium text-slate-900 dark:text-slate-100">{projectionSettings.horizonYears} years</span></span>
          {hasStochasticData && stochasticResult?.milestones.worstCaseHitTargetDate ? (
            <span>Conservative date: <span className="font-medium text-slate-900 dark:text-slate-100">{formatDate(stochasticResult.milestones.worstCaseHitTargetDate)}</span></span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
});
