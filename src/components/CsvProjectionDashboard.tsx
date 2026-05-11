import { memo, useCallback, useMemo, useState } from "react";
import type {
  ProjectionResult,
  ScenarioPack,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";
import { currency, pct, formatDate } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { LazySection } from "@/components/ui/lazy-section";
import { DriverCard } from "./dashboard/DriverCard";
import { AccountDiagnosticChart } from "./dashboard/charts/AccountDiagnosticChart";
import { OverviewCard } from "./dashboard/OverviewCard";
import { CashFlowWaterfall } from "./dashboard/CashFlowWaterfall";
import { NetWorthReconciliation } from "./dashboard/NetWorthReconciliation";
import { DebtSummary } from "./dashboard/DebtSummary";
import { TransactionCompletionTable } from "./dashboard/tables/TransactionCompletionTable";
import { ShortfallCalendar } from "./dashboard/ShortfallCalendar";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { useStore, selectActiveOverrideCount } from "@/store";
import { useDashboardDerivedValues } from "./dashboard/useDashboardDerivedValues";

interface ProjectionDashboardProps {
  pack: ScenarioPack;
  result: ProjectionResult;
  projectionSettings: ProjectionRuntimeSettings;
  stochasticResult?: StochasticProjectionResult | null;
}

export const ProjectionDashboard = memo(function ProjectionDashboard({
  pack,
  result,
  projectionSettings,
  stochasticResult,
}: ProjectionDashboardProps) {
  const [isPostingTablesOpen, setIsPostingTablesOpen] = useState(false);
  const hasStochasticData = stochasticResult !== undefined && stochasticResult !== null;
  const accountDiagnosticChartData = useMemo(
    () => buildAccountDiagnosticChartData(pack, result, stochasticResult),
    [pack, result, stochasticResult],
  );
  const activeOverrideCount = useStore(selectActiveOverrideCount);
  const derived = useDashboardDerivedValues(result, pack);
  const milestoneDates = useMemo(() => ({
    hitTarget: result.milestones.hitTargetDate ?? undefined,
    firstShortfall: derived.firstShortfallRow?.date ?? undefined,
  }), [result.milestones.hitTargetDate, derived.firstShortfallRow?.date]);
  const scrollToSourceData = useCallback(() => {
    const el = document.getElementById("model-inputs");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="space-y-6">
      <section id="projection-chart">
        <AccountDiagnosticChart
          pack={pack}
          targetNetWorth={projectionSettings.targetNetWorth}
          hasStochasticData={hasStochasticData}
          chartData={accountDiagnosticChartData}
          milestoneDates={milestoneDates}
        />
      </section>

      <section id="overview">
        <OverviewCard
          result={result}
          projectionSettings={projectionSettings}
          stochasticResult={stochasticResult}
          blockerValue={derived.blockerValue}
          blockerDetail={derived.blockerDetail}
          goalReached={derived.goalReached}
        />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <div className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${derived.statusBadgeClassName}`}>
          {derived.goalReached ? "On track" : "Off track"}
        </div>
        {activeOverrideCount > 0 ? (
          <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-amber-900">
            {activeOverrideCount} temporary override{activeOverrideCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </section>

      <section id="cash-flow-debt">
        <LazySection>
          <CollapsibleSection
            title="Cash flow, debt, and reconciliation"
            description="Monthly cash-flow map, debt summary, and current balance reconciliation."
            defaultOpen={false}
          >
          <div className="mt-5 space-y-5">
            <CashFlowWaterfall pack={pack} />
            <DebtSummary pack={pack} result={result} />
            <NetWorthReconciliation pack={pack} result={result} />
          </div>
          </CollapsibleSection>
        </LazySection>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-3">
          <DriverCard
            label="Main constraint"
            value={derived.blockerValue}
            detail={derived.blockerDetail}
            tone={derived.biggestShortfallPosting ? "warning" : derived.goalReached ? "success" : "default"}
          />
          <button
            type="button"
            onClick={scrollToSourceData}
            className="no-print w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Explore model inputs
          </button>
        </div>
        <DriverCard
          label="Next projected transaction"
          value={derived.firstProjectedRow ? formatDate(derived.firstProjectedRow.date) : "No future transactions"}
          detail={derived.nextEventDetail}
        />
        <DriverCard
          label="Planned transaction completion"
          value={pct.format(derived.postingUtilizationRate)}
          detail={derived.requestedPostingAmount === 0
            ? `No scheduled transactions are requesting future activity across ${derived.enabledPostingCount} transaction${derived.enabledPostingCount === 1 ? "" : "s"}.`
            : `The model applied ${currency.format(derived.realizedPostingAmount)} of ${currency.format(derived.requestedPostingAmount)} in planned transactions.`}
          tone={derived.postingUtilizationRate < 1 ? "warning" : "success"}
        />
      </section>

      <section id="projected-shortfalls">
        <ShortfallCalendar
          rows={result.timeline.rows}
          postings={pack.postings}
          accounts={pack.accounts}
        />
      </section>

      <CollapsibleSection
        open={isPostingTablesOpen}
        onOpenChange={setIsPostingTablesOpen}
        title="Scheduled transactions"
        description="Transaction completion rates."
        badge={isPostingTablesOpen ? "Close" : `${derived.enabledPostingCount} posting${derived.enabledPostingCount === 1 ? "" : "s"}`}
      >
        {isPostingTablesOpen ? (
          <div className="mt-5 grid gap-6">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" /> On track</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> Needs attention</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" /> Neutral</span>
            </div>
            <TransactionCompletionTable postingSummaries={result.postingSummaries} />
          </div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
});
