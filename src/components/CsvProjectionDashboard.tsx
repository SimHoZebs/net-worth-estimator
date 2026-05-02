import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CsvProjectionResult,
  CsvProjectionRow,
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";
import { currency, formatChartCurrencyTick, formatTooltipCurrency, pct, pluralize } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OutcomeMetric } from "./dashboard/OutcomeMetric";
import { CompactDetail } from "./dashboard/CompactDetail";
import { DriverCard } from "./dashboard/DriverCard";
import { buildBalanceChartData, buildStochasticChartData } from "@/chart/chartData";
import { formatRoute } from "@/lib/format";

interface CsvProjectionDashboardProps {
  pack: CsvScenarioPack;
  result: CsvProjectionResult;
  whatIfState: CsvScenarioWhatIfState;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  stochasticResult?: StochasticProjectionResult | null;
  children?: ReactNode;
}

export function CsvProjectionDashboard({
  pack,
  result,
  whatIfState,
  projectionSettings,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
  stochasticResult,
  children,
}: CsvProjectionDashboardProps) {
  const [isAccountDiagnosticsOpen, setIsAccountDiagnosticsOpen] = useState(false);
  const [isPostingTablesOpen, setIsPostingTablesOpen] = useState(false);
  const [isTrendChartReady, setIsTrendChartReady] = useState(false);
  const trendChartContainerRef = useRef<HTMLDivElement | null>(null);
  const latestRow = result.timeline.rows[result.timeline.rows.length - 1] ?? null;
  const firstProjectedRow = result.timeline.rows.find((row) => !row.isHistorical) ?? null;
  const futureRows = result.timeline.rows.filter((row) => !row.isHistorical);
  const firstShortfallRow = futureRows.find((row) => row.clampedPostingShortfallAmount > 0) ?? null;
  const biggestShortfallPosting = result.postingSummaries
    .filter((summary) => summary.shortfallAmount > 0)
    .sort((left, right) => right.shortfallAmount - left.shortfallAmount)[0] ?? null;
  const endingBalanceData = result.accountSummaries.map((summary) => ({
    id: summary.accountId,
    label: summary.label,
    color: summary.color ?? "#64748b",
    endingBalance: summary.endingBalance,
  }));
  const netWorthChartData = stochasticResult
    ? buildStochasticChartData(result, stochasticResult)
    : result.timeline.rows.map((row) => {
        const nw = row.netWorth;
        return {
          date: row.date,
          p10_base: nw,
          outerThickness: 0,
          p25_base: nw,
          innerThickness: 0,
          p50: nw,
          _p10: nw,
          _p90: nw,
          _p25: nw,
          _p75: nw,
        };
      });
  const hasStochasticData = stochasticResult !== undefined && stochasticResult !== null;
  const balanceChartData = buildBalanceChartData(pack, result);
  const activeOverrideCount = Object.keys(whatIfState.postingOverrides).length;
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

  useEffect(() => {
    const container = trendChartContainerRef.current;

    if (container === null) {
      return;
    }

    const updateReadyState = () => {
      setIsTrendChartReady(container.clientWidth > 0 && container.clientHeight > 0);
    };

    updateReadyState();

    const resizeObserver = new ResizeObserver(() => {
      updateReadyState();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [netWorthChartData.length, projectionSettings.targetNetWorth, hasStochasticData]);

  return (
    <div className="space-y-6">
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

        <Card className="min-w-0 rounded-[1.8rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <div>
              <CardTitle>Trend vs target</CardTitle>
              <CardDescription>{result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate} to {latestRow?.date ?? result.milestones.projectionStartDate}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            <div ref={trendChartContainerRef} className="min-w-0 h-[280px]">
              {isTrendChartReady ? (
                <ResponsiveContainer width="100%" height="100%">
                  {hasStochasticData ? (
                    <ComposedChart data={netWorthChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={36} />
                      <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const p = payload[0]?.payload as Record<string, number> | undefined;
                          if (!p) return null;
                          return (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                              <div className="text-xs font-medium text-slate-500">{label}</div>
                              <div className="mt-1 text-sm font-semibold text-slate-900">P50: {currency.format(p.p50)}</div>
                              <div className="text-xs text-slate-500">P10–P90: {currency.format(p._p10)}–{currency.format(p._p90)}</div>
                              <div className="text-xs text-slate-500">P25–P75: {currency.format(p._p25)}–{currency.format(p._p75)}</div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={projectionSettings.targetNetWorth} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain" />
                      <Area type="monotone" dataKey="p10_base" stackId="outer" stroke="none" fill="transparent" isAnimationActive={false} />
                      <Area type="monotone" dataKey="outerThickness" stackId="outer" stroke="none" fill="#0f172a" fillOpacity={0.08} isAnimationActive={false} />
                      <Area type="monotone" dataKey="p25_base" stackId="inner" stroke="none" fill="transparent" isAnimationActive={false} />
                      <Area type="monotone" dataKey="innerThickness" stackId="inner" stroke="none" fill="#0f172a" fillOpacity={0.16} isAnimationActive={false} />
                      <Line type="monotone" dataKey="p50" stroke="#0f172a" strokeWidth={2.5} dot={false} name="P50 median" isAnimationActive={false} />
                    </ComposedChart>
                  ) : (
                    <LineChart data={netWorthChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={36} />
                      <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                      <Tooltip formatter={formatTooltipCurrency} />
                      <ReferenceLine y={projectionSettings.targetNetWorth} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain" />
                      <Line type="monotone" dataKey="p50" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth" />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              ) : null}
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
        open={isAccountDiagnosticsOpen}
        onOpenChange={setIsAccountDiagnosticsOpen}
        title="Account diagnostics"
        description="Open for account-level balance curves and ending balances."
      >
        {isAccountDiagnosticsOpen ? (
          <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
            {balanceChartData.length > 0 ? (
              <Card className="min-w-0 rounded-[1.6rem] border-slate-200 shadow-sm">
                <CardHeader>
                  <div>
                    <CardTitle>Account balances over time</CardTitle>
                    <CardDescription>Enabled accounts across sampled checkpoint and event rows.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div className="min-w-0 h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={balanceChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" minTickGap={36} />
                        <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                        <Tooltip formatter={formatTooltipCurrency} />
                        {pack.accounts.filter((account) => account.enabled).map((account) => (
                          <Line
                            key={account.id}
                            type="monotone"
                            dataKey={account.id}
                            stroke={account.color ?? "#64748b"}
                            strokeWidth={2}
                            dot={false}
                            name={account.label}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card className="min-w-0 rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Ending balances by account</CardTitle>
                  <CardDescription>Signed ending balances at the horizon.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="min-w-0">
                <div className="min-w-0 h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={endingBalanceData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={0} angle={-20} textAnchor="end" height={70} />
                      <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                      <Tooltip formatter={formatTooltipCurrency} />
                      <Bar dataKey="endingBalance" name="Ending balance">
                        {endingBalanceData.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </CollapsibleSection>

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
                      <TableHead>Date</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Realized</TableHead>
                      <TableHead>Shortfall</TableHead>
                      <TableHead>Net worth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {futureRows.length > 0 ? futureRows.slice(0, 12).map((row: CsvProjectionRow) => (
                      <TableRow key={row.date}>
                        <TableCell>{row.date}</TableCell>
                        <TableCell>{currency.format(row.requestedPostingAmount)}</TableCell>
                        <TableCell>{currency.format(row.realizedPostingAmount)}</TableCell>
                        <TableCell>{currency.format(row.clampedPostingShortfallAmount)}</TableCell>
                        <TableCell>{currency.format(row.netWorth)}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-slate-500">No projected event rows are available.</TableCell>
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
