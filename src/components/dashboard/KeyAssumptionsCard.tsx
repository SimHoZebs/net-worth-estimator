import { memo, useState } from "react";
import type { ScenarioPack, ProjectionRuntimeSettings } from "@/lib/projection";
import { formatDate, formatCurrencyInput } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AssumptionList } from "@/components/dashboard/AssumptionList";

interface KeyAssumptionsCardProps {
  pack: ScenarioPack;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  projectionSettings: ProjectionRuntimeSettings;
  onProjectionSettingsChange?: (partial: Partial<ProjectionRuntimeSettings>) => void;
  activeOverrideCount: number;
  projectionStartDate: string;
  hasStochasticData: boolean;
}

export const KeyAssumptionsCard = memo(function KeyAssumptionsCard({
  pack,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
  projectionSettings,
  onProjectionSettingsChange,
  activeOverrideCount,
  projectionStartDate,
  hasStochasticData,
}: KeyAssumptionsCardProps) {
  const [isTargetFocused, setIsTargetFocused] = useState(false);

  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Key assumptions</CardTitle>
          <CardDescription>The scheduled transactions and settings that drive this projection.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Target net worth</div>
            {isTargetFocused ? (
              <input
                type="number"
                inputMode="numeric"
                step={1000}
                autoFocus
                value={targetNetWorthInput}
                onChange={(event) => onTargetNetWorthInputChange(event.currentTarget.value)}
                onBlur={() => setIsTargetFocused(false)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xl font-semibold text-slate-900 shadow-sm outline-none transition focus:border-slate-400"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsTargetFocused(true)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xl font-semibold text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-slate-400"
              >
                {formatCurrencyInput(targetNetWorthInput)}
              </button>
            )}
            <div className="mt-1 text-xs text-slate-400">Nominal dollars</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Projection horizon</div>
              <span className="text-lg font-semibold text-slate-900">{projectionSettings.horizonYears} yr</span>
            </div>
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              value={projectionSettings.horizonYears}
              onChange={(e) => {
                onProjectionSettingsChange?.({ horizonYears: Number(e.target.value) });
              }}
              className="mt-2 w-full accent-slate-900"
            />
            <div className="mt-1 text-xs text-slate-400">From {formatDate(projectionStartDate)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Overrides</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{activeOverrideCount === 0 ? "None" : String(activeOverrideCount)}</div>
            <div className="mt-1 text-xs text-slate-400">{activeOverrideCount === 0 ? "Baseline only" : "Temporary scenario changes"}</div>
          </div>
        </div>

        <AssumptionList pack={pack} />

        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            <span><span className="font-medium text-slate-900">{pack.accounts.filter((a) => a.enabled).length}</span> accounts tracked</span>
            <span><span className="font-medium text-slate-900">{pack.postings.filter((p) => p.enabled).length}</span> scheduled transactions</span>
            <span><span className="font-medium text-slate-900">{pack.checkpoints.length}</span> balance history points</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-xs font-medium tracking-wide text-slate-500">Annual rates</div>
          {pack.postings.filter(p => p.enabled && p.annualRate > 0).length > 0 ? (
            <div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-6 gap-y-1 text-sm">
              {pack.postings.filter((p) => p.enabled && p.annualRate > 0).map((p) => (
                <div key={p.id} className="contents">
                  <span className="text-slate-700">{p.label}:</span>
                  <span className="text-slate-400 italic">{p.annualGrowthRate > 0 ? `${(p.annualRate * 100).toFixed(1)}%, growing ${(p.annualGrowthRate * 100).toFixed(1)}%/yr` : `${(p.annualRate * 100).toFixed(1)}%`}</span>
                  <span className="text-right text-slate-500">
                    {p.volatility > 0 ? `±${(p.volatility * 100).toFixed(1)}%` : "Fixed"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-sm text-slate-400">No annual rates configured on enabled transactions.</div>
          )}
        </div>

        <div className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Model assumptions</div>
          <ul className="space-y-1 text-xs text-slate-600">
            <li>Taxes are modeled as a flat percentage of income — progressive brackets, deductions, and credits are not included.</li>
            <li>Investment returns, loan rates, and expense growth are treated as annual rates, converted to monthly in the projection.</li>
            <li>Inflation is not explicitly modeled. All values are in nominal dollars unless otherwise specified.</li>
            <li>Salary growth, expense growth, and loan rates are fixed at the values shown — they do not vary automatically with inflation or market conditions.</li>
          </ul>
        </div>
        {hasStochasticData ? (
          <div className="mt-3 text-xs text-slate-400">
            Monte Carlo simulation enabled. This depends on the assumptions above and is not a guarantee.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});
