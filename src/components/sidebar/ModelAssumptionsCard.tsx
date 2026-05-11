import { memo } from "react";
import type { ScenarioPack } from "@/lib/projection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ModelAssumptionsCardProps {
  pack: ScenarioPack;
  hasStochasticData: boolean;
}

export const ModelAssumptionsCard = memo(function ModelAssumptionsCard({
  pack,
  hasStochasticData,
}: ModelAssumptionsCardProps) {
  const enabledAccounts = pack.accounts.filter((account) => account.enabled).length;
  const enabledPostings = pack.postings.filter((posting) => posting.enabled).length;
  const annualRatePostings = pack.postings.filter((posting) => posting.enabled && posting.annualRate > 0);

  return (
    <Card className="rounded-[1.4rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardHeader>
        <CardTitle>Model assumptions</CardTitle>
        <CardDescription>Compact notes about rates and simplifications.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2 py-3">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{enabledAccounts}</div>
            <div className="text-[0.65rem] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Accounts</div>
          </div>
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2 py-3">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{enabledPostings}</div>
            <div className="text-[0.65rem] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Flows</div>
          </div>
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2 py-3">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{pack.checkpoints.length}</div>
            <div className="text-[0.65rem] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">History</div>
          </div>
        </div>

        <details className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
          <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Annual rates
          </summary>
          {annualRatePostings.length > 0 ? (
            <div className="mt-3 space-y-2 text-sm">
              {annualRatePostings.map((posting) => (
                <div key={posting.id} className="grid grid-cols-[1fr_auto] gap-3">
                  <span className="text-slate-700 dark:text-slate-300">{posting.label}</span>
                  <span className="text-right text-slate-500 dark:text-slate-400">
                    {(posting.annualRate * 100).toFixed(1)}%
                    {posting.annualGrowthRate > 0 ? `, +${(posting.annualGrowthRate * 100).toFixed(1)}%/yr` : ""}
                    {posting.volatility > 0 ? `, +/-${(posting.volatility * 100).toFixed(1)}%` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-sm text-slate-400 dark:text-slate-500">No annual rates configured on enabled transactions.</div>
          )}
        </details>

        <details className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
          <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Model boundaries
          </summary>
          <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
            <li>Taxes are modeled as a flat percentage of income.</li>
            <li>Investment returns, loan rates, and expense growth are annual rates converted to monthly.</li>
            <li>Inflation is not explicitly modeled; values are nominal dollars.</li>
            <li>Salary growth, expense growth, and loan rates stay fixed unless edited in the model inputs.</li>
          </ul>
        </details>

        {hasStochasticData ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">
            Monte Carlo bands are based on the volatile transactions configured in the input data.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});
