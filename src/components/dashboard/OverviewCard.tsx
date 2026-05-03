import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type { ProjectionResult, StochasticProjectionResult, ProjectionRuntimeSettings } from "@/lib/projection";

interface OverviewCardProps {
  result: ProjectionResult;
  projectionSettings: ProjectionRuntimeSettings;
  stochasticResult?: StochasticProjectionResult | null;
  blockerValue: string;
  blockerDetail: string;
  goalReached: boolean;
}

export function OverviewCard({
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
    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
      <CardContent className="p-5 md:p-6">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500">Current net worth</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{currency.format(current)}</div>
            <div className="text-sm text-slate-500">as of {formatDate(result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate)}</div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500">Target</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{currency.format(target)}</div>
            <div className="text-sm text-slate-500">Nominal dollars</div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500">Target date</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">
              {hasStochasticData && stochasticResult?.milestones.medianHitTargetDate
                ? formatDate(stochasticResult.milestones.medianHitTargetDate)
                : hitDate
                  ? formatDate(hitDate)
                  : "Beyond horizon"}
            </div>
            <div className="text-sm text-slate-500">
              {hasStochasticData && stochasticResult
                ? `Median across ${stochasticResult.config?.runCount ?? "simulated"} runs`
                : goalReached
                  ? "Deterministic projection"
                  : `Misses by ${currency.format(Math.abs(target - final))}`}
            </div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500">Confidence</div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">
              {hasStochasticData && stochasticResult
                ? pct.format(stochasticResult.milestones.hitTargetProbability)
                : goalReached ? "On track" : "Off track"}
            </div>
            <div className="text-sm text-slate-500">
              {hasStochasticData && stochasticResult
                ? "of simulated paths reached target"
                : goalReached
                  ? "Target reached within horizon"
                  : "Target not reached within horizon"}
            </div>
          </div>

          <div className="space-y-1 lg:col-span-1">
            <div className="text-xs font-medium text-slate-500">Main constraint</div>
            <div className="text-lg font-semibold tracking-tight text-slate-900">{blockerValue}</div>
            <div className="text-sm text-slate-600 line-clamp-2">{blockerDetail}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <span>Projected final: <span className="font-medium text-slate-900">{currency.format(final)}</span> on {formatDate(latestDate)}</span>
          <span>Horizon: <span className="font-medium text-slate-900">{projectionSettings.horizonYears} years</span></span>
          {hasStochasticData && stochasticResult?.milestones.worstCaseHitTargetDate ? (
            <span>Conservative date: <span className="font-medium text-slate-900">{formatDate(stochasticResult.milestones.worstCaseHitTargetDate)}</span></span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
