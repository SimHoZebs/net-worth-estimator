import { useMemo, useState, type ReactNode } from "react";
import type {
  ProjectionResult,
  ProjectionRow,
  ScenarioPack,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";
import { currency, pct, formatDate } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OutcomeMetric } from "./dashboard/OutcomeMetric";
import { CompactDetail } from "./dashboard/CompactDetail";
import { DriverCard } from "./dashboard/DriverCard";
import { AccountDiagnosticChart } from "./dashboard/AccountDiagnosticChart";
import { OverviewCard } from "./dashboard/OverviewCard";
import { CashFlowWaterfall } from "./dashboard/CashFlowWaterfall";
import { NetWorthReconciliation } from "./dashboard/NetWorthReconciliation";
import { DebtSummary } from "./dashboard/DebtSummary";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { formatRoute, formatFrequency } from "@/lib/format";
import { useStore } from "@/store";

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

function formatCurrencyInput(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return currency.format(num);
}

function AssumptionList({ pack }: { pack: ScenarioPack }) {
  const [showFormulas, setShowFormulas] = useState(false);
  const disabledPostingIds = useStore((s) => s.disabledPostingIds);
  const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
  const disabledSet = new Set(disabledPostingIds);
  const incomePostings = pack.postings.filter((p) => !p.sourceAccountId);
  const expensePostings = pack.postings.filter((p) => p.sourceAccountId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Showing {showFormulas ? "raw formulas" : "plain-language descriptions"}
        </div>
        <button
          type="button"
          onClick={() => setShowFormulas(!showFormulas)}
          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
        >
          {showFormulas ? "Hide formulas" : "Show formulas"}
        </button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Income</h4>
          <div className="space-y-1">
            {incomePostings.length > 0 ? (
              incomePostings.map((p) => {
                const isDisabled = disabledSet.has(p.id);
                return (
                  <div key={p.id} className={`flex items-center justify-between rounded-lg px-2 py-1 text-sm transition ${isDisabled ? "opacity-40" : "hover:bg-slate-50"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => togglePostingDisabled(p.id)}
                        className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                          isDisabled ? "border-slate-300 bg-white" : "border-slate-900 bg-slate-900"
                        }`}
                        title={isDisabled ? "Enable this posting" : "Disable this posting (what-if)"}
                      >
                        {isDisabled ? null : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className={`text-slate-700 ${isDisabled ? "line-through" : ""}`}>{p.label}</span>
                    </div>
                    <span className="font-medium text-slate-900">
                      {showFormulas ? `${p.arithmetic} (${formatFrequency(p.frequency)})` : `${formatFrequency(p.frequency)} inflow${isDisabled ? "" : ""}`}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400">No external income scheduled.</div>
            )}
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Expenses & transfers</h4>
          <div className="space-y-1">
            {expensePostings.length > 0 ? (
              expensePostings.map((p) => {
                const isDisabled = disabledSet.has(p.id);
                return (
                  <div key={p.id} className={`flex items-center justify-between rounded-lg px-2 py-1 text-sm transition ${isDisabled ? "opacity-40" : "hover:bg-slate-50"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => togglePostingDisabled(p.id)}
                        className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                          isDisabled ? "border-slate-300 bg-white" : "border-slate-900 bg-slate-900"
                        }`}
                        title={isDisabled ? "Enable this posting" : "Disable this posting (what-if)"}
                      >
                        {isDisabled ? null : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className={`text-slate-700 ${isDisabled ? "line-through" : ""}`}>{p.label}</span>
                    </div>
                    <span className="font-medium text-slate-900">
                      {showFormulas ? `${p.arithmetic} (${formatFrequency(p.frequency)})` : `${formatFrequency(p.frequency)} outflow`}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400">No outgoing transactions scheduled.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
  const [isTargetFocused, setIsTargetFocused] = useState(false);
  const latestRow = result.timeline.rows[result.timeline.rows.length - 1] ?? null;
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
  const activeOverrideCount = useStore(
    (s) =>
      s.addedAccounts.length +
      s.addedPostings.length +
      s.addedCheckpoints.length +
      s.disabledAccountIds.length +
      s.disabledPostingIds.length,
  );
  const goalReached = result.milestones.hitTargetDate !== null;
  const gapToTarget = projectionSettings.targetNetWorth - result.summary.finalNetWorth;
  const distanceToTarget = Math.abs(gapToTarget);
  const enabledPostingCount = pack.postings.filter((posting) => posting.enabled).length;
  const requestedPostingAmount = result.totals.requestedPostingAmount;
  const realizedPostingAmount = result.totals.realizedPostingAmount;
  const postingUtilizationRate = requestedPostingAmount === 0 ? 1 : realizedPostingAmount / requestedPostingAmount;
  const headline = (() => {
    if (hasStochasticData && stochasticResult) {
      const prob = pct.format(stochasticResult.milestones.hitTargetProbability);
      const medianDate = stochasticResult.milestones.medianHitTargetDate;
      return `${prob} of simulated paths reached ${currency.format(projectionSettings.targetNetWorth)}${medianDate ? ` by ${formatDate(medianDate)}` : ""}`;
    }

    return goalReached
      ? `Deterministic projection reaches ${currency.format(projectionSettings.targetNetWorth)} on ${formatDate(result.milestones.hitTargetDate!)}`
      : `Deterministic projection misses target by ${currency.format(distanceToTarget)}`;
  })();
  const headlineDetail = (() => {
    if (hasStochasticData && stochasticResult) {
      const finalP50 = currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p50);
      const hitDate = result.milestones.hitTargetDate;
      if (hitDate) {
        return `Deterministic target date: ${formatDate(hitDate)}. Median simulated final net worth is ${finalP50}.`;
      }
      return `Deterministic projection misses by ${currency.format(distanceToTarget)}. Median simulated final net worth is ${finalP50}.`;
    }

    return `Projected final net worth is ${currency.format(result.summary.finalNetWorth)} on ${formatDate(latestRow?.date ?? result.milestones.projectionStartDate)}.`;
  })();
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

      {/* Assumptions summary */}
      <section id="assumptions">
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
                <div className="mt-1 text-xs text-slate-400">From {formatDate(result.milestones.projectionStartDate)}</div>
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
        <DriverCard
          label="Main constraint"
          value={blockerValue}
          detail={blockerDetail}
          tone={biggestShortfallPosting ? "warning" : goalReached ? "success" : "default"}
        />
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
            <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Transaction completion</CardTitle>
                  <CardDescription>Which scheduled transactions were fully applied and which were limited by available funds.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead>Completion</TableHead>
                      <TableHead>First unfunded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.postingSummaries.length > 0 ? result.postingSummaries.map((summary) => {
                      const hasShortfall = summary.utilizationRate < 1;

                      return (
                        <TableRow key={summary.postingId}>
                          <TableCell>
                            <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{summary.label}</span>
                          </TableCell>
                          <TableCell>
                            <span className={hasShortfall ? "text-amber-700" : undefined}>{formatRoute(summary.sourceAccountLabel, summary.destinations)}</span>
                          </TableCell>
                          <TableCell>{summary.priority}</TableCell>
                          <TableCell>{currency.format(summary.requestedAmount)}</TableCell>
                          <TableCell>
                            <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(summary.realizedAmount)}</span>
                          </TableCell>
                          <TableCell>
                            <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{pct.format(summary.utilizationRate)}</span>
                          </TableCell>
                          <TableCell>
                            <span className={hasShortfall ? "font-medium text-amber-700" : "text-slate-400"}>{hasShortfall ? formatDate(summary.firstShortfallDate!) : "-"}</span>
                          </TableCell>
                        </TableRow>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-slate-500">No scheduled transactions are defined.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Upcoming projected transactions</CardTitle>
                  <CardDescription>The next projected dates and their requested vs applied scheduled activity.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead></TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead>Unfunded</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Net worth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeFutureRows.length > 0 ? activeFutureRows.slice(0, 12).map((row: ProjectionRow) => {
                      const isExpanded = expandedEventRows.has(row.date);
                      const activePostingIds = Object.entries(row.requestedPostingAmountsById)
                        .filter(([, amount]) => amount > 0)
                        .map(([id]) => id);
                      const hasShortfall = row.clampedPostingShortfallAmount > 0;

                      return (
                        <>
                          <TableRow
                            key={row.date}
                            className={`cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                            onClick={() => toggleEventRow(row.date)}
                          >
                            <TableCell className="w-8 select-none text-slate-400">
                              {isExpanded ? "▾" : "▸"}
                            </TableCell>
                            <TableCell>
                              <span className={hasShortfall ? "font-medium text-amber-700" : undefined}>{formatDate(row.date)}</span>
                            </TableCell>
                            <TableCell>
                              <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(row.requestedPostingAmount)}</span>
                            </TableCell>
                            <TableCell>
                              <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(row.realizedPostingAmount)}</span>
                            </TableCell>
                            <TableCell>
                              <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{currency.format(row.clampedPostingShortfallAmount)}</span>
                            </TableCell>
                            <TableCell>
                              {hasShortfall ? <span className="text-xs text-slate-600">Limited by available funds</span> : <span className="text-xs text-slate-400">—</span>}
                            </TableCell>
                            <TableCell>{currency.format(row.netWorth)}</TableCell>
                          </TableRow>
                          {isExpanded ? (
                            <TableRow key={`${row.date}-detail`}>
                              <TableCell colSpan={7} className="border-b-2 border-slate-100 bg-slate-50 p-0">
                                <div className="px-8 pb-2 pt-1">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-slate-100">
                                        <TableHead className="text-xs">Transaction</TableHead>
                                        <TableHead className="text-xs">Requested</TableHead>
                                        <TableHead className="text-xs">Applied</TableHead>
                                        <TableHead className="text-xs">Unfunded</TableHead>
                                        <TableHead className="text-xs">Reason</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {activePostingIds.map((id) => {
                                        const requested = row.requestedPostingAmountsById[id] ?? 0;
                                        const realized = row.realizedPostingAmountsById[id] ?? 0;
                                        const shortfall = requested - realized;
                                        const label = postingLabelById[id] ?? id;
                                        const perShortfall = shortfall > 0;
                                        return (
                                          <TableRow key={id} className="border-b-0">
                                            <TableCell className={perShortfall ? "font-medium text-amber-700" : undefined}>{label}</TableCell>
                                            <TableCell>{currency.format(requested)}</TableCell>
                                            <TableCell className={perShortfall ? "text-amber-700" : undefined}>{currency.format(realized)}</TableCell>
                                            <TableCell className={perShortfall ? "font-semibold text-amber-700" : undefined}>{currency.format(shortfall)}</TableCell>
                                            <TableCell className="text-xs text-slate-600">{perShortfall ? "Limited by available funds" : "—"}</TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-slate-500">No upcoming projected transactions are available.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}
