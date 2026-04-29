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
import { Card, CardContent } from "./ui";
import { currency, formatChartCurrencyTick, pct } from "../lib/format";
import { MODEL, monthLabel } from "../lib/projection";
import type { EventSummaryRow, ProjectionResult } from "../lib/projection";

const chartLabelByKey = Object.fromEntries(
  Object.entries(MODEL.accounts).map(([key, value]) => [key, value.label])
) as Record<string, string>;

interface ProjectionDashboardProps {
  maxYears: number;
  result: ProjectionResult;
  eventSummary: EventSummaryRow[];
}

export function ProjectionDashboard({ maxYears, result, eventSummary }: ProjectionDashboardProps) {
  const hitText = result.hitMonth === null
    ? `Not within ${maxYears} years`
    : `${Math.floor(result.hitMonth / 12)} years, ${result.hitMonth % 12} months`;
  const hitDate = result.hitMonth === null ? "-" : monthLabel(result.hitMonth);
  const studentLoanPaidOffText = result.studentLoanPaidOffMonth === null
    ? "Not within projection"
    : `${Math.floor(result.studentLoanPaidOffMonth / 12)} years, ${result.studentLoanPaidOffMonth % 12} months`;
  const studentLoanPaidOffDate = result.studentLoanPaidOffMonth === null ? "-" : monthLabel(result.studentLoanPaidOffMonth);
  const finalRow = result.rows[result.rows.length - 1];
  const effectiveTaxRate = result.firstYearTotalTax / Math.max(1, result.firstYearOrdinaryIncome);

  return (
    <div className="lg:col-span-2 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Time to $1M</p>
            <p className="text-2xl font-bold mt-1">{hitText}</p>
            <p className="text-sm text-slate-500 mt-1">Estimated date: {hitDate}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Student loan payoff</p>
            <p className="text-2xl font-bold mt-1">{studentLoanPaidOffText}</p>
            <p className="text-sm text-slate-500 mt-1">Estimated date: {studentLoanPaidOffDate}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Max extra cash flow</p>
            <p className="text-2xl font-bold mt-1">{currency.format(result.firstMonthMaxExtraFundContribution)} / mo</p>
            <p className="text-sm text-slate-500 mt-1">Goes to loan first, then fund. Max x: {pct.format(result.firstMonthMaxExtraFundPct)}</p>
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
              401(k): {currency.format(result.monthly401kEmployee)} / mo employee
              {result.monthly401kEmployer > 0 ? ` + ${currency.format(result.monthly401kEmployer)} / mo employer` : ""}
              <br />Ledger events modeled: {result.allEvents.length}
            </div>
          </div>

          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.rows} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={36} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Tooltip
                  formatter={(value: unknown, _name: unknown, item: { dataKey?: unknown }) => [
                    currency.format(Number(value ?? 0)),
                    chartLabelByKey[String(item?.dataKey ?? "")] ?? String(item?.dataKey ?? "Value"),
                  ]}
                  labelFormatter={(label: unknown) => `Date: ${String(label ?? "")}`}
                />
                <Legend formatter={(value: string) => chartLabelByKey[value] ?? value} />
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
              <BarChart data={result.annualTaxPlan} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
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
              <span>Federal taxable income</span><strong className="text-right text-slate-900">{currency.format(result.firstYearFederalTaxableIncome)}</strong>
              <span>Federal income tax</span><strong className="text-right text-slate-900">{currency.format(result.firstYearTaxEstimate.federalIncomeTax)}</strong>
              <span>Social Security tax</span><strong className="text-right text-slate-900">{currency.format(result.firstYearTaxEstimate.socialSecurityTax)}</strong>
              <span>Medicare tax</span><strong className="text-right text-slate-900">{currency.format(result.firstYearTaxEstimate.medicareTax)}</strong>
              <span>WA state income tax</span><strong className="text-right text-slate-900">{currency.format(result.firstYearTaxEstimate.stateIncomeTax)}</strong>
              <span>Total modeled tax</span><strong className="text-right text-slate-900">{currency.format(result.firstYearTotalTax)}</strong>
              <span>Effective tax rate</span><strong className="text-right text-slate-900">{pct.format(effectiveTaxRate)}</strong>
              <span>Tax allocated to salary</span><strong className="text-right text-slate-900">{currency.format(result.firstYearSalaryTax)}</strong>
              <span>Tax allocated to RSUs</span><strong className="text-right text-slate-900">{currency.format(result.firstYearRsuTax)}</strong>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-2">
            <h2 className="text-lg font-bold">Projection totals until chart endpoint</h2>
            <div className="grid grid-cols-2 gap-y-1 text-sm text-slate-600">
              <span>Employee 401(k), first year</span><strong className="text-right text-slate-900">{currency.format(result.annual401kEmployee)}</strong>
              <span>Employer match, first year</span><strong className="text-right text-slate-900">{currency.format(result.annual401kEmployer)}</strong>
              <span>Gross RSUs vested</span><strong className="text-right text-slate-900">{currency.format(result.totalGrossRsuVested)}</strong>
              <span>Net RSUs held as AMZN</span><strong className="text-right text-slate-900">{currency.format(result.totalNetRsuAdded)}</strong>
              <span>Taxable fund contributions</span><strong className="text-right text-slate-900">{currency.format(result.totalFundContributions)}</strong>
              <span>Student loan payments</span><strong className="text-right text-slate-900">{currency.format(result.totalStudentLoanPayments)}</strong>
              <span>Student loan interest</span><strong className="text-right text-slate-900">{currency.format(result.totalStudentLoanInterest)}</strong>
              <span>Fixed obligations paid</span><strong className="text-right text-slate-900">{currency.format(result.totalFixedExpenses)}</strong>
              <span>Cash-flow shortfall</span><strong className="text-right text-slate-900">{currency.format(result.totalCashShortfall)}</strong>
              <span>Uninvested after-tax cash</span><strong className="text-right text-slate-900">{currency.format(result.totalUninvestedCash)}</strong>
              <span>Final displayed net worth</span><strong className="text-right text-slate-900">{currency.format(finalRow?.netWorth ?? 0)}</strong>
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
