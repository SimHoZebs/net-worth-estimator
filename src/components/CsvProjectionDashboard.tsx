import {
  Area,
  AreaChart,
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
import type { CsvProjectionResult, CsvScenarioPack, CsvScenarioWhatIfState } from "@/lib/projection";
import { currency, formatChartCurrencyTick, pct } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CsvProjectionDashboardProps {
  pack: CsvScenarioPack;
  result: CsvProjectionResult;
  whatIfState: CsvScenarioWhatIfState;
}

function buildBalanceChartData(pack: CsvScenarioPack, result: CsvProjectionResult) {
  const enabledAssets = pack.accounts.filter((account) => account.enabled && account.balanceType === "asset");

  return result.timeline.sampledRows.map((row) => ({
    monthLabel: row.monthLabel,
    ...Object.fromEntries(enabledAssets.map((account) => [account.id, row.accountBalances[account.id] ?? 0])),
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

export function CsvProjectionDashboard({ pack, result, whatIfState }: CsvProjectionDashboardProps) {
  const latestRow = result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1] ?? null;
  const firstProjectedRow = result.timeline.monthlyRows.find((row) => !row.isHistorical) ?? null;
  const futureRows = result.timeline.monthlyRows.filter((row) => !row.isHistorical);
  const endingBalanceData = result.accountSummaries.map((summary) => ({
    id: summary.accountId,
    label: summary.label,
    color: summary.color ?? "#64748b",
    signedEndingBalance: summary.signedEndingBalance,
  }));
  const netWorthChartData = result.timeline.monthlyRows.map((row) => ({
    monthLabel: row.monthLabel,
    netWorth: row.netWorth,
  }));
  const balanceChartData = buildBalanceChartData(pack, result);
  const goalText = result.milestones.hitTargetMonthLabel
    ? `Target reached in ${result.milestones.hitTargetMonthLabel}`
    : `Not within ${pack.scenario.horizonMonths} projected months`;
  const activeOverrideCount = Object.keys(whatIfState.contributionPlanOverrides).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="Current net worth"
          value={currency.format(result.summary.currentNetWorth)}
          detail={result.milestones.latestHistoricalMonthLabel ? `Latest historical month: ${result.milestones.latestHistoricalMonthLabel}` : `Projection starts in ${pack.scenario.startDate}`}
        />
        <SummaryCard
          title="Projected final net worth"
          value={currency.format(result.summary.finalNetWorth)}
          detail={`Final projected month: ${latestRow?.monthLabel ?? pack.scenario.startDate}`}
        />
        <SummaryCard
          title="Goal progress"
          value={goalText}
          detail={`Target net worth: ${currency.format(pack.scenario.targetNetWorth)}`}
        />
        <SummaryCard
          title="Latest checkpoint"
          value={result.milestones.latestCheckpointDate ?? "No checkpoints"}
          detail={result.milestones.latestCheckpointMonthLabel ? `Checkpoint month: ${result.milestones.latestCheckpointMonthLabel}` : "Historical view starts from opening balances only."}
        />
        <SummaryCard
          title="Average investable capacity"
          value={currency.format(result.totals.averageProjectedInvestableCapacity)}
          detail={firstProjectedRow ? `First projected month: ${currency.format(firstProjectedRow.investableCapacity)}` : "No projected months."}
        />
        <SummaryCard
          title="Realized contributions"
          value={currency.format(result.totals.realizedContributions)}
          detail={`Requested ${currency.format(result.totals.requestedContributions)} across ${pack.contributionPlans.length} plans`}
        />
      </div>

      {activeOverrideCount > 0 ? (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-5 text-sm text-slate-600">
            {activeOverrideCount} temporary contribution override{activeOverrideCount === 1 ? " is" : "s are"} active in this projection view.
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Net worth timeline</h2>
            <p className="text-sm text-slate-500">Historical months come from checkpoints. Future months come from contribution plans, transfers, and account growth.</p>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={netWorthChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" minTickGap={36} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                <Line type="monotone" dataKey="netWorth" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {balanceChartData.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Asset balances over time</h2>
              <p className="text-sm text-slate-500">Enabled asset accounts are charted without any account-specific exclusions.</p>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={balanceChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" minTickGap={36} />
                  <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                  <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                  {pack.accounts.filter((account) => account.enabled && account.balanceType === "asset").map((account) => (
                    <Area
                      key={account.id}
                      type="monotone"
                      dataKey={account.id}
                      stackId="assets"
                      stroke={account.color ?? "#64748b"}
                      fill={account.color ?? "#64748b"}
                      fillOpacity={0.4}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5">
          <h2 className="mb-2 text-xl font-bold text-slate-900">Ending balances by account</h2>
          <p className="mb-4 text-sm text-slate-500">Liabilities are shown as negative balances so the chart reflects their net-worth impact.</p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={endingBalanceData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                <Bar dataKey="signedEndingBalance" name="Ending balance">
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
              <p className="text-sm text-slate-500">Requested contributions are clamped by investable capacity, annual caps, and liability balances.</p>
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
              <h2 className="text-lg font-bold text-slate-900">Next projected months</h2>
              <p className="text-sm text-slate-500">Capacity is computed separately from realized balance changes.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Net worth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futureRows.slice(0, 12).map((row) => (
                  <TableRow key={row.monthLabel}>
                    <TableCell>{row.monthLabel}</TableCell>
                    <TableCell>{currency.format(row.investableCapacity)}</TableCell>
                    <TableCell>{currency.format(row.requestedContributionAmount)}</TableCell>
                    <TableCell>{currency.format(row.realizedContributionAmount)}</TableCell>
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
