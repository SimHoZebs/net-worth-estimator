import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { currency, formatChartCurrencyTick, pct } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CsvProjectionDashboardProps {
  pack: CsvScenarioPack;
  result: CsvProjectionResult;
  whatIfState: CsvScenarioWhatIfState;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
  children?: ReactNode;
}

function buildBalanceChartData(pack: CsvScenarioPack, result: CsvProjectionResult) {
  const enabledAccounts = pack.accounts.filter((account) => account.enabled);

  return result.timeline.sampledRows.map((row) => ({
    date: row.date,
    ...Object.fromEntries(enabledAccounts.map((account) => [account.id, row.accountBalances[account.id] ?? 0])),
  }));
}

function formatRoute(sourceLabel: string | null, destinations: Array<{ accountId: string; label: string }> | null) {
  const destinationLabel = destinations === null ? "External" : destinations.map((dest) => dest.label).join(" ; ");

  return `${sourceLabel ?? "External"} -> ${destinationLabel}`;
}

function OutcomeMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{detail}</div>
    </div>
  );
}

function CompactDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function DriverCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClassName = tone === "success"
    ? "border-emerald-200 bg-emerald-50"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <Card className={`rounded-[1.6rem] shadow-sm ${toneClassName}`}>
      <CardContent className="space-y-2 p-5">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
        <div className="text-lg font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-sm text-slate-600">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function CsvProjectionDashboard({
  pack,
  result,
  whatIfState,
  projectionSettings,
  targetNetWorthInput,
  onTargetNetWorthInputChange,
  children,
}: CsvProjectionDashboardProps) {
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
  const netWorthChartData = result.timeline.rows.map((row) => ({
    date: row.date,
    netWorth: row.netWorth,
  }));
  const balanceChartData = buildBalanceChartData(pack, result);
  const activeOverrideCount = Object.keys(whatIfState.postingOverrides).length;
  const goalReached = result.milestones.hitTargetDate !== null;
  const gapToTarget = projectionSettings.targetNetWorth - result.summary.finalNetWorth;
  const distanceToTarget = Math.abs(gapToTarget);
  const enabledPostingCount = pack.postings.filter((posting) => posting.enabled).length;
  const requestedPostingAmount = result.totals.requestedPostingAmount;
  const realizedPostingAmount = result.totals.realizedPostingAmount;
  const postingUtilizationRate = requestedPostingAmount === 0 ? 1 : realizedPostingAmount / requestedPostingAmount;
  const headline = goalReached
    ? `Hits ${currency.format(projectionSettings.targetNetWorth)} on ${result.milestones.hitTargetDate}`
    : `Misses target by ${currency.format(distanceToTarget)}`;
  const headlineDetail = goalReached
    ? `Projected final net worth is ${currency.format(result.summary.finalNetWorth)} on ${latestRow?.date ?? result.milestones.projectionStartDate}.`
    : `Projected final net worth is ${currency.format(result.summary.finalNetWorth)} on ${latestRow?.date ?? result.milestones.projectionStartDate}.`;
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
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
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

        <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <div>
              <CardTitle>Trend vs target</CardTitle>
              <CardDescription>{result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate} to {latestRow?.date ?? result.milestones.projectionStartDate}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={netWorthChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={36} />
                  <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                  <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                  <ReferenceLine y={projectionSettings.targetNetWorth} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain" />
                  <Line type="monotone" dataKey="netWorth" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth" />
                </LineChart>
              </ResponsiveContainer>
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

      <details className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300">
        <summary className="cursor-pointer list-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Account diagnostics</div>
              <div className="text-sm text-slate-500">Open for account-level balance curves and ending balances.</div>
            </div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Details</div>
          </div>
        </summary>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
          {balanceChartData.length > 0 ? (
            <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Account balances over time</CardTitle>
                  <CardDescription>Enabled accounts across sampled checkpoint and event rows.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={balanceChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={36} />
                      <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                      <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
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

          <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
            <CardHeader>
              <div>
                <CardTitle>Ending balances by account</CardTitle>
                <CardDescription>Signed ending balances at the horizon.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={endingBalanceData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" interval={0} angle={-20} textAnchor="end" height={70} />
                    <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                    <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
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
      </details>

      <details
        open={firstShortfallRow !== null}
        className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300"
      >
        <summary className="cursor-pointer list-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900">Posting tables</div>
              <div className="text-sm text-slate-500">Open for route-level utilization and the exact projected event rows.</div>
            </div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
              {firstShortfallRow ? `Shortfall starts ${firstShortfallRow.date}` : `${futureRows.length} future row${futureRows.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </summary>

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
      </details>
    </div>
  );
}
