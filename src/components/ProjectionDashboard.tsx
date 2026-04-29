import { Fragment } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { currency, formatChartCurrencyTick, pct } from "../lib/format";
import { MODEL, type DashboardViewModel, type EventSummaryRow, type ProjectionResult } from "../lib/projection";
import { Card, CardContent } from "./ui";

interface ProjectionDashboardProps {
  result: ProjectionResult;
  dashboard: DashboardViewModel;
  eventSummary: EventSummaryRow[];
}

export default function ProjectionDashboard({ result, dashboard, eventSummary }: ProjectionDashboardProps) {
  return (
    <div className="lg:col-span-2 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Time to $1M</p>
            <p className="text-2xl font-bold mt-1">{dashboard.hitText}</p>
            <p className="text-sm text-slate-500 mt-1">Estimated date: {dashboard.hitDate}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Student loan payoff</p>
            <p className="text-2xl font-bold mt-1">{dashboard.studentLoanPaidOffText}</p>
            <p className="text-sm text-slate-500 mt-1">Estimated date: {dashboard.studentLoanPaidOffDate}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Max extra cash flow</p>
            <p className="text-2xl font-bold mt-1">{currency.format(result.cashFlow.firstMonthMaxExtraFundContribution)} / mo</p>
            <p className="text-sm text-slate-500 mt-1">Goes to loan first, then fund. Max x: {pct.format(result.cashFlow.firstMonthMaxExtraFundPct)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-4">
            <div>
              <h2 className="text-xl font-bold">Projected net worth composition</h2>
              <p className="text-sm text-slate-500">Stacked area view shows how each account bucket contributes to total net worth.</p>
            </div>
            <div className="text-sm text-slate-600">
              401(k): {currency.format(result.contributions.monthlyEmployee401k)} / mo employee
              {result.contributions.monthlyEmployer401k > 0 ? ` + ${currency.format(result.contributions.monthlyEmployer401k)} / mo employer` : ""}
              <br />Ledger events modeled: {result.events.all.length}
            </div>
          </div>

          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.timeline.sampledRows} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={36} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip
                  formatter={(value: unknown, _name: unknown, item: { dataKey?: unknown }) => [
                    currency.format(Number(value ?? 0)),
                    dashboard.chartLabelByKey[String(item?.dataKey ?? "") as keyof typeof dashboard.chartLabelByKey] ?? String(item?.dataKey ?? "Value"),
                  ]}
                  labelFormatter={(label: unknown) => `Date: ${String(label ?? "")}`}
                />
                <Legend formatter={(value: string) => dashboard.chartLabelByKey[value as keyof typeof dashboard.chartLabelByKey] ?? value} />
                <ReferenceLine y={MODEL.targetNetWorth} stroke="#16a34a" strokeDasharray="6 6" label={{ value: "$1M target", position: "insideTopRight" }} />
                {Object.entries(MODEL.accounts).map(([key, account]) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="netWorthBuckets"
                    stroke={account.color}
                    fill={account.color}
                    fillOpacity={0.55}
                    name={account.label}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5">
          <h2 className="text-xl font-bold mb-2">RSU income by modeled year</h2>
          <p className="text-sm text-slate-500 mb-4">This makes the backloaded 5/15/40/40 schedule visible instead of hiding it inside annual total compensation.</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dashboard.annualTaxPlan} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    currency.format(Number(value ?? 0)),
                    name === "rsuIncome" ? "Gross RSU income" : name === "netRsu" ? "Net RSUs held" : "Total tax",
                  ]}
                />
                <Legend />
                <Bar dataKey="rsuIncome" name="Gross RSU income" fill={MODEL.accounts.amazonStock.color} />
                <Bar dataKey="netRsu" name="Net RSUs held" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-2">
            <h2 className="text-lg font-bold">First-year tax estimate</h2>
            <div className="grid grid-cols-2 gap-y-1 text-sm text-slate-600">
              <span>Federal taxable income</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.federalTaxableIncome)}</strong>
              <span>Federal income tax</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.estimate.federalIncomeTax)}</strong>
              <span>Social Security tax</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.estimate.socialSecurityTax)}</strong>
              <span>Medicare tax</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.estimate.medicareTax)}</strong>
              <span>WA state income tax</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.estimate.stateIncomeTax)}</strong>
              <span>Total modeled tax</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.totalTax)}</strong>
              <span>Effective tax rate</span><strong className="text-right text-slate-900">{pct.format(dashboard.effectiveTaxRate)}</strong>
              <span>Tax allocated to salary</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.salaryTax)}</strong>
              <span>Tax allocated to RSUs</span><strong className="text-right text-slate-900">{currency.format(result.taxes.firstYear.rsuTax)}</strong>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-2">
            <h2 className="text-lg font-bold">Projection totals until chart endpoint</h2>
            <div className="grid grid-cols-2 gap-y-1 text-sm text-slate-600">
              <span>Employee 401(k), first year</span><strong className="text-right text-slate-900">{currency.format(result.contributions.annualEmployee401k)}</strong>
              <span>Employer match, first year</span><strong className="text-right text-slate-900">{currency.format(result.contributions.annualEmployer401k)}</strong>
              <span>Gross RSUs vested</span><strong className="text-right text-slate-900">{currency.format(result.totals.grossRsuVested)}</strong>
              <span>Net RSUs held as AMZN</span><strong className="text-right text-slate-900">{currency.format(result.totals.netRsuAdded)}</strong>
              <span>Taxable fund contributions</span><strong className="text-right text-slate-900">{currency.format(result.totals.fundContributions)}</strong>
              <span>Student loan payments</span><strong className="text-right text-slate-900">{currency.format(result.totals.studentLoanPayments)}</strong>
              <span>Student loan interest</span><strong className="text-right text-slate-900">{currency.format(result.totals.studentLoanInterest)}</strong>
              <span>Fixed obligations paid</span><strong className="text-right text-slate-900">{currency.format(result.totals.fixedExpenses)}</strong>
              <span>Cash-flow shortfall</span><strong className="text-right text-slate-900">{currency.format(result.totals.cashShortfall)}</strong>
              <span>Uninvested after-tax cash</span><strong className="text-right text-slate-900">{currency.format(result.totals.uninvestedCash)}</strong>
              <span>Final displayed net worth</span><strong className="text-right text-slate-900">{currency.format(dashboard.finalNetWorth)}</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5 space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Ledger event summary</h2>
            <p className="text-sm text-slate-500">Every condition emits events. The projection engine processes those events month by month.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600">
            {eventSummary.map((row) => (
              <Fragment key={row.type}>
                <span className="capitalize">{row.label} <span className="text-slate-400">({row.count})</span></span>
                <strong className="text-right text-slate-900">{currency.format(row.amount)}</strong>
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-5 space-y-3 text-sm text-slate-600">
          <h2 className="text-lg font-bold text-slate-900">Model notes</h2>
          <p>
            Month 0 can use an actual paycheck override. In that mode, the model uses the provided regular gross, signing bonus, and take-home cash. Because the paycheck take-home already reflects payroll benefit deductions, the first month does not subtract the health/dental benefits field again from cash flow.
          </p>
          <p>
            Student loans are modeled as a negative net-worth account with monthly compounding interest. When loan-first payoff is enabled, the same extra-cash-flow amount that would have gone to the taxable fund is sent to the loan until the balance reaches zero; only then does taxable fund investing resume.
          </p>
          <p>
            Taxes are estimated yearly from ordinary income, then allocated between salary and RSUs. This approximates tax liability, not exact paycheck withholding. RSUs are treated as W-2 ordinary income at vest; after-tax shares are held as Amazon stock.
          </p>
          <p>
            Amazon initial RSUs are modeled as 5% at month 12, 15% at month 24, and 20% at months 30, 36, 42, and 48. Future refreshers default to 25% of base salary per year and use the same modeled 5/15/40/40 vesting pattern. If salary-growth scaling is enabled, future refresher grants grow with the raised base salary.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
