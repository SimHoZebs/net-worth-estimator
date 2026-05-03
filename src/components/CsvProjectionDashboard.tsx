import { useMemo, useState, type ReactNode } from "react";
import type {
  ProjectionResult,
  ScenarioPack,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";
import { currency, pct, formatDate } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DriverCard } from "./dashboard/DriverCard";
import { AccountDiagnosticChart } from "./dashboard/AccountDiagnosticChart";
import { OverviewCard } from "./dashboard/OverviewCard";
import { CashFlowWaterfall } from "./dashboard/CashFlowWaterfall";
import { NetWorthReconciliation } from "./dashboard/NetWorthReconciliation";
import { DebtSummary } from "./dashboard/DebtSummary";
import { KeyAssumptionsCard } from "./dashboard/KeyAssumptionsCard";
import { TransactionCompletionTable } from "./dashboard/TransactionCompletionTable";
import { UpcomingProjectedTransactions } from "./dashboard/UpcomingProjectedTransactions";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { useStore, selectActiveOverrideCount } from "@/store";

interface ProjectionDashboardProps {
  pack: ScenarioPack;
  result: ProjectionResult;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  onProjectionSettingsChange?: (partial: Partial<ProjectionRuntimeSettings>) => void;
  stochasticResult?: StochasticProjectionResult | null;
  children?: ReactNode;
}

export function ProjectionDashboard({
  pack,
  result,
  projectionSettings,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
  onProjectionSettingsChange,
  stochasticResult,
  children,
}: ProjectionDashboardProps) {
  const [isPostingTablesOpen, setIsPostingTablesOpen] = useState(false);
  const [expandedEventRows, setExpandedEventRows] = useState<Set<string>>(new Set());
  const firstProjectedRow = result.timeline.rows.find((row) => !row.isHistorical) ?? null;
  const futureRows = result.timeline.rows.filter((row) => !row.isHistorical);
  const firstShortfallRow = futureRows.find((row) => row.clampedPostingShortfallAmount > 0) ?? null;
  const postingLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of pack.postings) map[p.id] = p.label;
    return map;
  }, [pack.postings]);
  const toggleEventRow = (date: string) => {
    setExpandedEventRows(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };
  const activeFutureRows = futureRows.filter(row => row.requestedPostingAmount > 0);
  const biggestShortfallPosting = result.postingSummaries
    .filter((summary) => summary.shortfallAmount > 0)
    .sort((left, right) => right.shortfallAmount - left.shortfallAmount)[0] ?? null;
  const hasStochasticData = stochasticResult !== undefined && stochasticResult !== null;
  const accountDiagnosticChartData = useMemo(
    () => buildAccountDiagnosticChartData(pack, result, stochasticResult),
    [pack, result, stochasticResult],
  );
  const activeOverrideCount = useStore(selectActiveOverrideCount);
  const goalReached = result.milestones.hitTargetDate !== null;
  const enabledPostingCount = pack.postings.filter((posting) => posting.enabled).length;
  const requestedPostingAmount = result.totals.requestedPostingAmount;
  const realizedPostingAmount = result.totals.realizedPostingAmount;
  const postingUtilizationRate = requestedPostingAmount === 0 ? 1 : realizedPostingAmount / requestedPostingAmount;
  const statusBadgeClassName = goalReached
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
  const blockerValue = biggestShortfallPosting?.label ?? (goalReached ? "No constraint showing" : "No constraint showing");
  const blockerDetail = biggestShortfallPosting
    ? biggestShortfallPosting.firstShortfallDate
      ? `Starting ${formatDate(biggestShortfallPosting.firstShortfallDate)}, the model cannot fully fund this scheduled payment from checking. Total unfunded amount across the projection: ${currency.format(biggestShortfallPosting.shortfallAmount)}.`
      : `The model cannot fully fund this scheduled payment. Total unfunded amount: ${currency.format(biggestShortfallPosting.shortfallAmount)}.`
    : goalReached
      ? "No scheduled payment is currently limited by available funds, so the plan reaches the target without a visible cash-flow constraint."
      : "No scheduled payment is currently limited by available funds, so the shortfall is coming from overall cash-flow magnitude or growth assumptions rather than a hard funding constraint.";
  const nextEventDetail = firstProjectedRow === null
    ? "No projected transactions are scheduled after the historical balance history."
    : `${currency.format(firstProjectedRow.requestedPostingAmount)} requested and ${currency.format(firstProjectedRow.realizedPostingAmount)} applied${firstProjectedRow.clampedPostingShortfallAmount > 0 ? `, leaving ${currency.format(firstProjectedRow.clampedPostingShortfallAmount)} unfunded.` : "."}`;

  return (
    <div className="space-y-6">
      <section id="projection-chart">
        <AccountDiagnosticChart
          pack={pack}
          targetNetWorth={projectionSettings.targetNetWorth}
          hasStochasticData={hasStochasticData}
          chartData={accountDiagnosticChartData}
          milestoneDates={{
            hitTarget: result.milestones.hitTargetDate ?? undefined,
            firstShortfall: firstShortfallRow?.date ?? undefined,
          }}
        />
      </section>

      <OverviewCard
        result={result}
        projectionSettings={projectionSettings}
        stochasticResult={stochasticResult}
        blockerValue={blockerValue}
        blockerDetail={blockerDetail}
        goalReached={goalReached}
      />

      <section className="flex flex-wrap items-center gap-2">
        <div className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusBadgeClassName}`}>
          {goalReached ? "On track" : "Off track"}
        </div>
        {activeOverrideCount > 0 ? (
          <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-amber-900">
            {activeOverrideCount} temporary override{activeOverrideCount === 1 ? "" : "s"}
          </div>
        ) : null}
      </section>

      <section id="assumptions">
        <KeyAssumptionsCard
          pack={pack}
          targetNetWorthInput={targetNetWorthInput}
          onTargetNetWorthInputChange={onTargetNetWorthInputChange}
          projectionSettings={projectionSettings}
          onProjectionSettingsChange={onProjectionSettingsChange}
          activeOverrideCount={activeOverrideCount}
          projectionStartDate={result.milestones.projectionStartDate}
          hasStochasticData={hasStochasticData}
        />
      </section>

      <section id="cash-flow-debt">
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
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-3">
          <DriverCard
            label="Main constraint"
            value={blockerValue}
            detail={blockerDetail}
            tone={biggestShortfallPosting ? "warning" : goalReached ? "success" : "default"}
          />
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("source-data");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="no-print w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Explore fixes
          </button>
        </div>
        <DriverCard
          label="Next projected transaction"
          value={firstProjectedRow ? formatDate(firstProjectedRow.date) : "No future transactions"}
          detail={nextEventDetail}
        />
        <DriverCard
          label="Planned transaction completion"
          value={pct.format(postingUtilizationRate)}
          detail={requestedPostingAmount === 0
            ? `No scheduled transactions are requesting future activity across ${enabledPostingCount} transaction${enabledPostingCount === 1 ? "" : "s"}.`
            : `The model applied ${currency.format(realizedPostingAmount)} of ${currency.format(requestedPostingAmount)} in planned transactions.`}
          tone={postingUtilizationRate < 1 ? "warning" : "success"}
        />
      </section>

      {children ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Scenario overrides</h2>
            <p className="text-sm text-slate-500">Change scheduled postings only after checking the baseline answer above.</p>
          </div>
          {children}
        </section>
      ) : null}

      <CollapsibleSection
        open={isPostingTablesOpen}
        onOpenChange={setIsPostingTablesOpen}
        title="Scheduled transactions"
        description="Transaction completion rates and upcoming projected transactions."
        badge={isPostingTablesOpen ? "Close" : firstShortfallRow ? `Unfunded amount starts ${formatDate(firstShortfallRow.date)}` : `${futureRows.length} upcoming transaction${futureRows.length === 1 ? "" : "s"}`}
      >
        {isPostingTablesOpen ? (
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" /> On track</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> Needs attention</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" /> Neutral</span>
            </div>
            <div />
            <TransactionCompletionTable postingSummaries={result.postingSummaries} />
            <UpcomingProjectedTransactions
              rows={activeFutureRows}
              expandedEventRows={expandedEventRows}
              onToggleEventRow={toggleEventRow}
              postingLabelById={postingLabelById}
            />
          </div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}
