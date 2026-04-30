import { Fragment } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildAnnualTaxPlanDisplayRows, type DashboardViewModel, type EventSummaryRow, type ProjectionResult, type ScenarioDefinition } from "../lib/projection";
import { currency, formatChartCurrencyTick, pct } from "../lib/format";
import { Card, CardContent } from "@/components/ui/card";

interface ProjectionDashboardProps {
  scenario: ScenarioDefinition;
  result: ProjectionResult;
  dashboard: DashboardViewModel;
  eventSummary: EventSummaryRow[];
}

function buildAssetChartData(result: ProjectionResult, accountIds: string[]) {
  return result.timeline.sampledRows.map((row) => ({
    date: row.date,
    ...Object.fromEntries(accountIds.map((accountId) => [accountId, row.accountBalances[accountId] ?? 0])),
  }));
}

export default function ProjectionDashboard({ scenario, result, dashboard, eventSummary }: ProjectionDashboardProps) {
  const assetChartData = buildAssetChartData(result, dashboard.assetAccountIds);
  const endingBalanceData = dashboard.endingBalanceRows.map((row) => ({
    id: row.accountId,
    label: row.label,
    color: row.color,
    signedBalance: row.signedBalance,
  }));
  const lastRow = result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1];
  const annualTaxPlan = buildAnnualTaxPlanDisplayRows(result);

  return (
    <div className="space-y-6 lg:col-span-2">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Goal progress</p>
            <p className="mt-1 text-2xl font-bold">{dashboard.hitText}</p>
            <p className="mt-1 text-sm text-slate-500">Target date: {dashboard.hitDate}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Final net worth</p>
            <p className="mt-1 text-2xl font-bold">{currency.format(dashboard.finalNetWorth)}</p>
            <p className="mt-1 text-sm text-slate-500">Final snapshot: {lastRow?.date ?? "-"}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Scenario footprint</p>
            <p className="mt-1 text-2xl font-bold">{dashboard.totalAccounts}</p>
            <p className="mt-1 text-sm text-slate-500">Accounts, {dashboard.totalModules} modules, {dashboard.totalPolicies} policies</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Allocation friction</p>
            <p className="mt-1 text-2xl font-bold">{currency.format(result.totals.cashShortfall + result.totals.uninvestedCash)}</p>
            <p className="mt-1 text-sm text-slate-500">
              Shortfall: {currency.format(result.totals.cashShortfall)}. Swept remainder: {currency.format(result.totals.uninvestedCash)}. Effective first-year tax rate: {pct.format(dashboard.effectiveTaxRate)}
            </p>
          </CardContent>
        </Card>
      </div>

      {dashboard.assetAccountIds.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="mb-2 text-xl font-bold">Asset account balances</h2>
                <p className="text-sm text-slate-500">Every non-cash asset account is charted dynamically from the scenario definition.</p>
              </div>
              <div className="text-sm text-slate-600">
                Available to allocate in month 0: {currency.format(result.cashFlow.firstMonthAvailableCashBeforeAllocation)}
                <br />Requested in month 0: {currency.format(result.cashFlow.firstMonthRequestedAllocationAmount)}
              </div>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={assetChartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={36} />
                  <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                  <Tooltip formatter={(value: unknown, name: unknown) => [currency.format(Number(value ?? 0)), dashboard.accountLabelsById[String(name ?? "")] ?? String(name ?? "")]} />
                  <Legend formatter={(value: string) => dashboard.accountLabelsById[value] ?? value} />
                  {dashboard.assetAccountIds.map((accountId) => (
                    <Area
                      key={accountId}
                      type="monotone"
                      dataKey={accountId}
                      stackId="assets"
                      stroke={dashboard.accountColorsById[accountId] ?? "#64748b"}
                      fill={dashboard.accountColorsById[accountId] ?? "#64748b"}
                      fillOpacity={0.45}
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
          <h2 className="mb-2 text-xl font-bold">Ending balances by account</h2>
          <p className="mb-4 text-sm text-slate-500">Liabilities are shown as negative balances so the chart aligns with net-worth impact.</p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={endingBalanceData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip formatter={(value: unknown) => currency.format(Number(value ?? 0))} />
                <Bar dataKey="signedBalance" name="Ending balance">
                  {endingBalanceData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {dashboard.liabilityRows.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Liability status</h2>
              <p className="text-sm text-slate-500">Payoff timing and servicing cost are derived dynamically from liability accounts and emitted events.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 pr-4 font-medium">Payoff</th>
                    <th className="py-2 pr-4 font-medium">Remaining balance</th>
                    <th className="py-2 pr-4 font-medium">Interest paid</th>
                    <th className="py-2 pr-4 font-medium">Debt payments</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.liabilityRows.map((row) => (
                    <tr key={row.accountId} className="border-b border-slate-100">
                      <td className="py-2 pr-4">{row.label}</td>
                      <td className="py-2 pr-4">{row.payoffDate}</td>
                      <td className="py-2 pr-4">{currency.format(row.currentBalance)}</td>
                      <td className="py-2 pr-4">{currency.format(row.totalInterest)}</td>
                      <td className="py-2 pr-4">{currency.format(row.totalDebtPayments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dashboard.retirementRows.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Retirement contributions</h2>
              <p className="text-sm text-slate-500">Derived from generic contribution events grouped by destination account.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 pr-4 font-medium">Employee year 1</th>
                    <th className="py-2 pr-4 font-medium">Employer year 1</th>
                    <th className="py-2 pr-4 font-medium">Employee month 0</th>
                    <th className="py-2 pr-4 font-medium">Employer month 0</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.retirementRows.map((row) => (
                    <tr key={row.accountId} className="border-b border-slate-100">
                      <td className="py-2 pr-4">{row.label}</td>
                      <td className="py-2 pr-4">{currency.format(row.annualEmployeeContribution)}</td>
                      <td className="py-2 pr-4">{currency.format(row.annualEmployerContribution)}</td>
                      <td className="py-2 pr-4">{currency.format(row.firstMonthEmployeeContribution)}</td>
                      <td className="py-2 pr-4">{currency.format(row.firstMonthEmployerContribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dashboard.equityRows.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Equity vesting summary</h2>
              <p className="text-sm text-slate-500">Gross vest events and after-tax holdings are derived from the generic event stream by destination account.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 pr-4 font-medium">Gross vested</th>
                    <th className="py-2 pr-4 font-medium">Net added</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.equityRows.map((row) => (
                    <tr key={row.accountId} className="border-b border-slate-100">
                      <td className="py-2 pr-4">{row.label}</td>
                      <td className="py-2 pr-4">{currency.format(row.grossVested)}</td>
                      <td className="py-2 pr-4">{currency.format(row.netAdded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dashboard.allocationRows.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Allocation outcomes</h2>
              <p className="text-sm text-slate-500">How much value was transferred or used to reduce balances, grouped by destination account.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 pr-4 font-medium">Transfers in</th>
                    <th className="py-2 pr-4 font-medium">Debt reduction</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.allocationRows.map((row) => (
                    <tr key={row.accountId} className="border-b border-slate-100">
                      <td className="py-2 pr-4">{row.label}</td>
                      <td className="py-2 pr-4">{currency.format(row.totalTransfersIn)}</td>
                      <td className="py-2 pr-4">{currency.format(row.totalDebtReduction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {annualTaxPlan.length > 0 ? (
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Tax plan snapshot</h2>
              <p className="text-sm text-slate-500">Shown only when the scenario includes the built-in tax module.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Year</th>
                    <th className="py-2 pr-4 font-medium">Ordinary income</th>
                    <th className="py-2 pr-4 font-medium">Pre-tax contributions</th>
                    <th className="py-2 pr-4 font-medium">Total tax</th>
                  </tr>
                </thead>
                <tbody>
                  {annualTaxPlan.map((year) => (
                    <tr key={year.yearIndex} className="border-b border-slate-100">
                      <td className="py-2 pr-4">{year.label}</td>
                      <td className="py-2 pr-4">{currency.format(year.ordinaryIncome)}</td>
                      <td className="py-2 pr-4">{currency.format(year.preTax401kContribution)}</td>
                      <td className="py-2 pr-4">{currency.format(year.totalTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Event summary</h2>
            <p className="text-sm text-slate-500">The compiler emits domain events; the runtime executes generic operations. This summary reflects the emitted event stream.</p>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm text-slate-600 md:grid-cols-2">
            {eventSummary.map((row) => (
              <Fragment key={row.type}>
                <span className="capitalize">{row.label} <span className="text-slate-400">({row.count})</span></span>
                <strong className="text-right text-slate-900">{currency.format(row.amount)}</strong>
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
