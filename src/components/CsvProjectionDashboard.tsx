import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CsvProjectionResult,
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import { currency, formatChartCurrencyTick, pct } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CsvProjectionDashboardProps {
  pack: CsvScenarioPack;
  result: CsvProjectionResult;
  whatIfState: CsvScenarioWhatIfState;
  projectionSettings: ProjectionRuntimeSettings;
  targetNetWorthInput: string;
  onTargetNetWorthInputChange: (value: string) => void;
}

function buildBalanceChartData(pack: CsvScenarioPack, result: CsvProjectionResult) {
  const enabledAccounts = pack.accounts.filter((account) => account.enabled);

  return result.timeline.sampledRows.map((row) => ({
    date: row.date,
    ...Object.fromEntries(enabledAccounts.map((account) => [account.id, row.accountBalances[account.id] ?? 0])),
  }));
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-5">
        <p className="text-sm text-slate-500">{title}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function GoalCard({
  title,
  value,
  detail,
  tone = "default",
}: {
  title: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning";
}) {
  const toneClassName = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-slate-200 bg-white text-slate-900";

  return (
    <Card className={`rounded-[1.8rem] border shadow-sm ${toneClassName}`}>
      <CardContent className="p-5">
        <p className="text-sm opacity-70">{title}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
        <p className="mt-2 text-sm opacity-80">{detail}</p>
      </CardContent>
    </Card>
  );
}

function TargetNetWorthCard({
  targetNetWorthInput,
  horizonYears,
  onChange,
}: {
  targetNetWorthInput: string;
  horizonYears: number;
  onChange: (value: string) => void;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="space-y-3 p-5">
        <div>
          <p className="text-sm text-slate-500">Target net worth</p>
          <p className="mt-1 text-sm text-slate-500">Session-only runtime setting. Horizon is fixed at {horizonYears} years.</p>
        </div>
        <input
          type="number"
          inputMode="numeric"
          step={1000}
          value={targetNetWorthInput}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-900 shadow-sm outline-none transition focus:border-slate-400"
        />
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
}: CsvProjectionDashboardProps) {
  const latestRow = result.timeline.rows[result.timeline.rows.length - 1] ?? null;
  const firstProjectedRow = result.timeline.rows.find((row) => !row.isHistorical) ?? null;
  const futureRows = result.timeline.rows.filter((row) => !row.isHistorical);
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
  const goalText = result.milestones.hitTargetDate
    ? `Target reached on ${result.milestones.hitTargetDate}`
    : `Not within ${projectionSettings.horizonYears} projected years`;
  const activeOverrideCount = Object.keys(whatIfState.contributionPlanOverrides).length;
  const gapToTarget = projectionSettings.targetNetWorth - result.summary.finalNetWorth;
  const goalTone = result.milestones.hitTargetDate ? "success" : "warning";
  const enabledContributionPlans = pack.contributionPlans.filter((plan) => plan.enabled).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr_1fr]">
        <GoalCard
          title="Plan outcome"
          value={goalText}
          detail={result.milestones.hitTargetDate
            ? `The current projection crosses ${currency.format(projectionSettings.targetNetWorth)} on that date.`
            : `Projected finish is ${currency.format(Math.abs(gapToTarget))} ${gapToTarget > 0 ? "below" : "above"} the target.`}
          tone={goalTone}
        />
        <GoalCard
          title="Latest checkpoint net worth"
          value={currency.format(result.summary.currentNetWorth)}
          detail={result.milestones.latestHistoricalDate
            ? `Latest historical date: ${result.milestones.latestHistoricalDate}`
            : `Projection starts from opening balances on ${result.milestones.projectionStartDate}`}
        />
        <GoalCard
          title="Projected final net worth"
          value={currency.format(result.summary.finalNetWorth)}
          detail={`Final projected date: ${latestRow?.date ?? result.milestones.projectionStartDate}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TargetNetWorthCard
          targetNetWorthInput={targetNetWorthInput}
          horizonYears={projectionSettings.horizonYears}
          onChange={onTargetNetWorthInputChange}
        />
        <SummaryCard
          title="Latest available capacity"
          value={currency.format(result.totals.latestAvailableContributionCapacity)}
          detail={firstProjectedRow ? `First projected event: ${firstProjectedRow.date}` : "No projected events."}
        />
        <SummaryCard
          title="Realized contributions"
          value={currency.format(result.totals.realizedContributions)}
          detail={`Requested ${currency.format(result.totals.requestedContributions)} across ${enabledContributionPlans} enabled plans`}
        />
        <SummaryCard
          title="Latest checkpoint"
          value={result.milestones.latestCheckpointDate ?? "No checkpoints"}
          detail={result.milestones.latestCheckpointDate ? `Projection starts after ${result.milestones.latestCheckpointDate}` : `Projection fallback date: ${result.milestones.projectionStartDate}`}
        />
      </div>

      {activeOverrideCount > 0 ? (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-5 text-sm text-slate-600">
            {activeOverrideCount} temporary contribution override{activeOverrideCount === 1 ? " is" : "s are"} active in this projection view.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Net worth timeline</h2>
              <p className="text-sm text-slate-500">Historical rows come from checkpoints. Future rows come from dated budget, contribution, and transfer events with daily compounding between dates.</p>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={netWorthChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={36} />
                  <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                  <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                  <Line type="monotone" dataKey="netWorth" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Next projected events</h2>
              <p className="text-sm text-slate-500">Use this to see which dated events are funded immediately and which remain limited by available capacity.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Realized</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futureRows.slice(0, 6).map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>{currency.format(row.availableContributionCapacity)}</TableCell>
                    <TableCell>{currency.format(row.requestedContributionAmount)}</TableCell>
                    <TableCell>{currency.format(row.realizedContributionAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {balanceChartData.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Account balances over time</h2>
              <p className="text-sm text-slate-500">Enabled accounts are charted with their actual signed balances on each checkpoint or dated event.</p>
            </div>
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

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5">
          <h2 className="mb-2 text-xl font-bold text-slate-900">Ending balances by account</h2>
          <p className="mb-4 text-sm text-slate-500">Bars reflect each account's actual signed ending balance.</p>
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Contribution utilization</h2>
              <p className="text-sm text-slate-500">Requested contributions are clamped by dated available capacity and annual caps.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.contributionSummaries.length > 0 ? result.contributionSummaries.map((summary) => (
                  <TableRow key={summary.contributionPlanId}>
                    <TableCell>{summary.label}</TableCell>
                    <TableCell>{summary.targetAccountLabel}</TableCell>
                    <TableCell>{summary.priority}</TableCell>
                    <TableCell>{currency.format(summary.requestedAmount)}</TableCell>
                    <TableCell>{currency.format(summary.realizedAmount)}</TableCell>
                    <TableCell>{pct.format(summary.utilizationRate)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-slate-500">No contribution plans are defined.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Upcoming event rows</h2>
              <p className="text-sm text-slate-500">Budget cashflows adjust available capacity without directly changing tracked account balances.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Net worth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futureRows.slice(0, 12).map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>{currency.format(row.budgetCashflowAmount)}</TableCell>
                    <TableCell>{currency.format(row.availableContributionCapacity)}</TableCell>
                    <TableCell>{currency.format(row.netWorth)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
