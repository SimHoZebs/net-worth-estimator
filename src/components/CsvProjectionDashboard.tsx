import { useMemo, useState, type ReactNode } from "react";
import type {
  ProjectionResult,
  ProjectionRow,
  ScenarioPack,
  ScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";
import { currency, pct } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OutcomeMetric } from "./dashboard/OutcomeMetric";
import { CompactDetail } from "./dashboard/CompactDetail";
import { DriverCard } from "./dashboard/DriverCard";
import { AccountDiagnosticChart } from "./dashboard/AccountDiagnosticChart";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { formatRoute } from "@/lib/format";

interface ProjectionDashboardProps {
  pack: ScenarioPack;
  result: ProjectionResult;
  whatIfState: ScenarioWhatIfState;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  stochasticResult?: StochasticProjectionResult | null;
  children?: ReactNode;
}

export function ProjectionDashboard({
  pack,
  result,
  whatIfState,
  projectionSettings,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
  stochasticResult,
  children,
}: ProjectionDashboardProps) {
  const [isPostingTablesOpen, setIsPostingTablesOpen] = useState(false);
  const [expandedEventRows, setExpandedEventRows] = useState<Set<string>>(new Set());
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
  const activeOverrideCount =
    whatIfState.addedAccounts.length +
    whatIfState.addedPostings.length +
    whatIfState.addedCheckpoints.length +
    whatIfState.disabledAccountIds.length +
    whatIfState.disabledPostingIds.length;
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
      if (goalReached) {
        return `${prob} chance of ${currency.format(projectionSettings.targetNetWorth)}${stochasticResult.milestones.medianHitTargetDate ? ` by ${stochasticResult.milestones.medianHitTargetDate}` : ""}`;
      }
      return `${prob} chance of ${currency.format(projectionSettings.targetNetWorth)}`;
    }

    return goalReached
      ? `Hits ${currency.format(projectionSettings.targetNetWorth)} on ${result.milestones.hitTargetDate}`
      : `Misses target by ${currency.format(distanceToTarget)}`;
  })();
  const headlineDetail = (() => {
    if (hasStochasticData && stochasticResult) {
      const finalP50 = currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p50);
      const hitDate = result.milestones.hitTargetDate;
      if (hitDate) {
        return `Deterministic: hits target on ${hitDate}. P50 final net worth: ${finalP50}.`;
      }
      return `Deterministic: misses by ${currency.format(distanceToTarget)}. P50 final net worth: ${finalP50}.`;
    }

    return goalReached
      ? `Projected final net worth is ${currency.format(result.summary.finalNetWorth)} on ${latestRow?.date ?? result.milestones.projectionStartDate}.`
      : `Projected final net worth is ${currency.format(result.summary.finalNetWorth)} on ${latestRow?.date ?? result.milestones.projectionStartDate}.`;
  })();
  const statusBadgeClassName = goalReached
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
  const blockerValue = biggestShortfallPosting?.label ?? (goalReached ? "No clamp showing" : "No clamp showing");
  const blockerDetail = biggestShortfallPosting
    ? `${currency.format(biggestShortfallPosting.shortfallAmount)} missed${biggestShortfallPosting.firstShortfallDate ? `, first visible on ${biggestShortfallPosting.firstShortfallDate}` : ""}.`
    : goalReached
      ? "No posting is currently clamping, so the plan is reaching the target without a visible cash-flow constraint."
      : "No posting is currently clamping, so the miss is coming from overall cash-flow magnitude or growth assumptions rather than a hard utilization shortfall.";
  const nextEventDetail = firstProjectedRow === null
    ? "No projected rows are scheduled after the historical checkpoints."
    : `${currency.format(firstProjectedRow.requestedPostingAmount)} requested and ${currency.format(firstProjectedRow.realizedPostingAmount)} realized${firstProjectedRow.clampedPostingShortfallAmount > 0 ? `, leaving ${currency.format(firstProjectedRow.clampedPostingShortfallAmount)} short.` : "."}`;

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
                    detail={result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate}
                  />
                  <OutcomeMetric
                    label="Projected Final"
                    value={currency.format(result.summary.finalNetWorth)}
                    detail={latestRow?.date ?? result.milestones.projectionStartDate}
                  />
                  <OutcomeMetric
                    label={goalReached ? "Surplus" : "Gap"}
                    value={currency.format(distanceToTarget)}
                    detail={goalReached ? "Above target at the horizon" : "Still needed by the horizon"}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Target</div>
                <input
                  type="number"
                  inputMode="numeric"
                  step={1000}
                  value={targetNetWorthInput}
                  onChange={(event) => onTargetNetWorthInputChange(event.currentTarget.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-2xl font-semibold text-slate-900 shadow-sm outline-none transition focus:border-slate-400"
                />
                <div className="mt-4">
                  <CompactDetail label="Horizon" value={`${projectionSettings.horizonYears} years`} />
                  <CompactDetail label="Start" value={result.milestones.projectionStartDate} />
                  <CompactDetail label="Overrides" value={activeOverrideCount === 0 ? "None" : String(activeOverrideCount)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <DriverCard
          label="Main blocker"
          value={blockerValue}
          detail={blockerDetail}
          tone={biggestShortfallPosting ? "warning" : goalReached ? "success" : "default"}
        />
        <DriverCard
          label="Next event"
          value={firstProjectedRow?.date ?? "No future rows"}
          detail={nextEventDetail}
        />
        <DriverCard
          label="Scheduled flow capture"
          value={pct.format(postingUtilizationRate)}
          detail={requestedPostingAmount === 0
            ? `No enabled postings are requesting future activity across ${enabledPostingCount} posting${enabledPostingCount === 1 ? "" : "s"}.`
            : `${currency.format(realizedPostingAmount)} realized from ${currency.format(requestedPostingAmount)} requested.`}
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
        title="Posting tables"
        description="Open for route-level utilization and the exact projected event rows."
        badge={isPostingTablesOpen ? "Close" : firstShortfallRow ? `Shortfall starts ${firstShortfallRow.date}` : `${futureRows.length} future row${futureRows.length === 1 ? "" : "s"}`}
      >
        {isPostingTablesOpen ? (
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Posting utilization</CardTitle>
                  <CardDescription>Which scheduled postings are fully realized and which ones clamp.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Posting</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Realized</TableHead>
                      <TableHead>Utilization</TableHead>
                      <TableHead>First shortfall</TableHead>
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
                            <span className={hasShortfall ? "font-medium text-amber-700" : "text-slate-400"}>{hasShortfall ? summary.firstShortfallDate : "-"}</span>
                          </TableCell>
                        </TableRow>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-slate-500">No postings are defined.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Upcoming event rows</CardTitle>
                  <CardDescription>The first projected dates and their requested vs realized scheduled activity.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead></TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Realized</TableHead>
                      <TableHead>Shortfall</TableHead>
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
                              <span className={hasShortfall ? "font-medium text-amber-700" : undefined}>{row.date}</span>
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
                                        <TableHead className="text-xs">Posting</TableHead>
                                        <TableHead className="text-xs">Requested</TableHead>
                                        <TableHead className="text-xs">Realized</TableHead>
                                        <TableHead className="text-xs">Shortfall</TableHead>
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
                        <TableCell colSpan={6} className="py-6 text-center text-slate-500">No projected event rows are available.</TableCell>
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
