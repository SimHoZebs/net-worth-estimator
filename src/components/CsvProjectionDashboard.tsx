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
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { formatRoute } from "@/lib/format";
import { useStore } from "@/store";

interface ProjectionDashboardProps {
  pack: ScenarioPack;
  result: ProjectionResult;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  stochasticResult?: StochasticProjectionResult | null;
  children?: ReactNode;
}

function formatCurrencyInput(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return currency.format(num);
}

export function ProjectionDashboard({
  pack,
  result,
  projectionSettings,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
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
      <AccountDiagnosticChart
        pack={pack}
        targetNetWorth={projectionSettings.targetNetWorth}
        hasStochasticData={hasStochasticData}
        chartData={accountDiagnosticChartData}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <Card className="min-w-0 rounded-[1.8rem] border-slate-200 shadow-sm">
          <CardContent className="p-5 md:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusBadgeClassName}`}>
                    {goalReached ? "On track" : "Off track"}
                  </div>
                  {activeOverrideCount > 0 ? (
                    <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-amber-900">
                      {activeOverrideCount} override{activeOverrideCount === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">{headline}</h2>
                  <p className="text-sm text-slate-600 md:text-base">{headlineDetail}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <OutcomeMetric
                    label="Current"
                    value={currency.format(result.summary.currentNetWorth)}
                    detail={formatDate(result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate)}
                  />
                  <OutcomeMetric
                    label="Projected Final"
                    value={currency.format(result.summary.finalNetWorth)}
                    detail={formatDate(latestRow?.date ?? result.milestones.projectionStartDate)}
                  />
                  <OutcomeMetric
                    label={goalReached ? "Surplus" : "Gap"}
                    value={currency.format(distanceToTarget)}
                    detail={goalReached ? "Above target at the horizon" : "Still needed by the horizon"}
                  />
                </div>
              </div>

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
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-2xl font-semibold text-slate-900 shadow-sm outline-none transition focus:border-slate-400"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsTargetFocused(true)}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-2xl font-semibold text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-slate-400"
                  >
                    {formatCurrencyInput(targetNetWorthInput)}
                  </button>
                )}
                <div className="mt-1 text-xs text-slate-400">Nominal dollars</div>
                <div className="mt-4">
                  <CompactDetail label="Horizon" value={`${projectionSettings.horizonYears} years`} />
                  <CompactDetail label="Start" value={formatDate(result.milestones.projectionStartDate)} />
                  <CompactDetail label="Overrides" value={activeOverrideCount === 0 ? "None" : String(activeOverrideCount)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Assumptions summary */}
      <section>
        <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Key assumptions</CardTitle>
              <CardDescription>The scheduled transactions and settings that drive this projection.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Income</h4>
                <div className="space-y-1">
                  {pack.postings.filter((p) => p.enabled && !p.sourceAccountId).length > 0 ? (
                    pack.postings
                      .filter((p) => p.enabled && !p.sourceAccountId)
                      .map((p) => (
                        <div key={p.id} className="flex justify-between text-sm">
                          <span className="text-slate-700">{p.label}</span>
                          <span className="font-medium text-slate-900">{p.arithmetic} ({p.frequency})</span>
                        </div>
                      ))
                  ) : (
                    <div className="text-sm text-slate-400">No external income scheduled.</div>
                  )}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Expenses & transfers</h4>
                <div className="space-y-1">
                  {pack.postings.filter((p) => p.enabled && p.sourceAccountId).length > 0 ? (
                    pack.postings
                      .filter((p) => p.enabled && p.sourceAccountId)
                      .map((p) => (
                        <div key={p.id} className="flex justify-between text-sm">
                          <span className="text-slate-700">{p.label}</span>
                          <span className="font-medium text-slate-900">{p.arithmetic} ({p.frequency})</span>
                        </div>
                      ))
                  ) : (
                    <div className="text-sm text-slate-400">No outgoing transactions scheduled.</div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                <span><span className="font-medium text-slate-900">{pack.accounts.filter((a) => a.enabled).length}</span> accounts tracked</span>
                <span><span className="font-medium text-slate-900">{pack.postings.filter((p) => p.enabled).length}</span> scheduled transactions</span>
                <span><span className="font-medium text-slate-900">{pack.checkpoints.length}</span> balance history points</span>
                <span><span className="font-medium text-slate-900">{projectionSettings.horizonYears} years</span> projection horizon</span>
              </div>
            </div>
            {hasStochasticData ? (
              <div className="mt-3 text-xs text-slate-400">
                Monte Carlo simulation enabled. This depends on the assumptions above and is not a guarantee.
              </div>
            ) : null}
          </CardContent>
        </Card>
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
                            <TableCell>{currency.format(row.netWorth)}</TableCell>
                          </TableRow>
                          {isExpanded ? (
                            <TableRow key={`${row.date}-detail`}>
                              <TableCell colSpan={6} className="border-b-2 border-slate-100 bg-slate-50 p-0">
                                <div className="px-8 pb-2 pt-1">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-slate-100">
                                        <TableHead className="text-xs">Transaction</TableHead>
                                        <TableHead className="text-xs">Requested</TableHead>
                                        <TableHead className="text-xs">Applied</TableHead>
                                        <TableHead className="text-xs">Unfunded</TableHead>
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
                        <TableCell colSpan={6} className="py-6 text-center text-slate-500">No upcoming projected transactions are available.</TableCell>
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
