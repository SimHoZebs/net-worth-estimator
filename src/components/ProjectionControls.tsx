import { NumberField } from "./NumberField";
import { PercentSlider } from "./PercentSlider";
import { Card, CardContent } from "./ui";
import { currency, pct } from "../lib/format";
import { DEFAULT_REFRESHER_PCT_OF_BASE } from "../lib/projection";
import type { ProjectionFormState, ProjectionResult } from "../lib/projection";

type UpdateField = <Key extends keyof ProjectionFormState>(field: Key, value: ProjectionFormState[Key]) => void;

interface ProjectionControlsProps {
  form: ProjectionFormState;
  result: ProjectionResult;
  extraContributionIsCapped: boolean;
  updateField: UpdateField;
}

export function ProjectionControls({ form, result, extraContributionIsCapped, updateField }: ProjectionControlsProps) {
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-1">
      <CardContent className="p-6 space-y-6">
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Compensation</h2>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Base salary" value={form.baseSalary} onChange={(value) => updateField("baseSalary", value)} />
            <NumberField
              label="Initial RSU grant value"
              value={form.initialRsuGrantValue}
              onChange={(value) => updateField("initialRsuGrantValue", value)}
              helper="Default $140k implies $56k/year in years 3-4."
            />
            <NumberField
              label="Months at Amazon"
              value={form.monthsAtAmazon}
              onChange={(value) => updateField("monthsAtAmazon", value)}
              helper="Used to place remaining initial-grant vests."
            />
            <NumberField
              label="Future annual refresh grant"
              value={form.futureAnnualRefreshGrantValue}
              onChange={(value) => updateField("futureAnnualRefreshGrantValue", value)}
              helper={`Default assumes ${pct.format(DEFAULT_REFRESHER_PCT_OF_BASE)} of base salary/year. Refreshers are discretionary and performance/level dependent.`}
            />
            <NumberField
              label="Annual raise"
              value={form.annualRaisePct}
              onChange={(value) => updateField("annualRaisePct", value)}
              helper="Applied to base salary each modeled year. Salary-linked 401(k), match, taxes, and optional refresher sizing follow this."
            />
            <div className="col-span-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.useSalaryGrowthForRefreshers}
                  onChange={(event) => updateField("useSalaryGrowthForRefreshers", event.currentTarget.checked)}
                />
                <span>
                  Scale future refresh grant as {pct.format(DEFAULT_REFRESHER_PCT_OF_BASE)} of that year&apos;s raised base salary. Turn off to keep the manual future refresh grant fixed every year.
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Actual first-month paycheck</h2>
          <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-600 rounded-xl bg-slate-50 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.useActualFirstMonthPaycheck}
              onChange={(event) => updateField("useActualFirstMonthPaycheck", event.currentTarget.checked)}
            />
            <span>
              Use actual partial-month paycheck for month 0. Your screenshot shows a partial regular paycheck plus a signing bonus, with benefits already deducted from take-home.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Regular gross" value={form.firstMonthRegularGross} onChange={(value) => updateField("firstMonthRegularGross", value)} />
            <NumberField label="Signing bonus" value={form.firstMonthSigningBonus} onChange={(value) => updateField("firstMonthSigningBonus", value)} />
            <NumberField label="Take home" value={form.firstMonthTakeHome} onChange={(value) => updateField("firstMonthTakeHome", value)} />
            <NumberField
              label="401(k) this paycheck"
              value={form.firstMonthEmployee401k}
              onChange={(value) => updateField("firstMonthEmployee401k", value)}
              helper="Set this if a 401(k) line appears on the paycheck."
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 space-y-3 text-sm text-slate-600">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.useActualFirstMonthContributionAllocation}
                onChange={(event) => updateField("useActualFirstMonthContributionAllocation", event.currentTarget.checked)}
              />
              <span>Use actual first-month loan/fund contributions instead of the projected x% allocation.</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="Actual loan payment"
                value={form.firstMonthActualStudentLoanPayment}
                onChange={(value) => updateField("firstMonthActualStudentLoanPayment", value)}
              />
              <NumberField
                label="Actual fund contribution"
                value={form.firstMonthActualTaxableFundContribution}
                onChange={(value) => updateField("firstMonthActualTaxableFundContribution", value)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold">Current balances</h2>
          <div className="grid grid-cols-2 gap-4">
            <NumberField className="col-span-2" label="Current net worth" value={form.currentNetWorth} onChange={(value) => updateField("currentNetWorth", value)} />
            <NumberField label="Current 401(k)" value={form.current401kBalance} onChange={(value) => updateField("current401kBalance", value)} />
            <NumberField label="Current AMZN stock" value={form.currentAmazonStockBalance} onChange={(value) => updateField("currentAmazonStockBalance", value)} />
          </div>
        </div>

        <PercentSlider
          label="Pre-tax 401(k) contribution"
          value={form.k401ContributionPctInput}
          onChange={(value) => updateField("k401ContributionPctInput", value)}
          min={0}
          max={25}
          step={0.5}
          suffix="% of base"
        />
        <PercentSlider
          label="Extra fund contribution / debt payoff rate, x"
          value={form.extraInvestmentPct}
          onChange={(value) => updateField("extraInvestmentPct", value)}
          min={0}
          max={80}
          step={1}
          suffix="% of after-tax cash"
        />

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Student loan</h2>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Loan balance" value={form.studentLoanBalance} onChange={(value) => updateField("studentLoanBalance", value)} />
            <NumberField
              label="Interest rate"
              value={form.studentLoanInterestRatePct}
              onChange={(value) => updateField("studentLoanInterestRatePct", value)}
              helper="Annual rate; compounded monthly in the model."
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-600 rounded-xl bg-slate-50 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.payStudentLoanBeforeInvesting}
              onChange={(event) => updateField("payStudentLoanBeforeInvesting", event.currentTarget.checked)}
            />
            <span>Send the extra contribution to student loans first. Taxable fund investing starts only after the loan is gone.</span>
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Fixed monthly obligations</h2>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Rent" value={form.monthlyRent} onChange={(value) => updateField("monthlyRent", value)} />
            <NumberField label="Parking" value={form.monthlyParking} onChange={(value) => updateField("monthlyParking", value)} />
            <NumberField
              label="Health/dental benefits"
              value={form.monthlyHealthDentalBenefits}
              onChange={(value) => updateField("monthlyHealthDentalBenefits", value)}
              helper="Modeled as monthly after-tax cash obligation."
            />
            <NumberField
              label="Other fixed expenses"
              value={form.otherMonthlyFixedExpenses}
              onChange={(value) => updateField("otherMonthlyFixedExpenses", value)}
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex justify-between gap-4"><span>Total fixed obligations</span><strong className="text-slate-900">{currency.format(result.monthlyFixedExpenses)} / mo</strong></div>
            <div className="flex justify-between gap-4"><span>Max feasible extra contribution</span><strong className="text-slate-900">{currency.format(result.firstMonthMaxExtraFundContribution)} / mo</strong></div>
            <div className="flex justify-between gap-4"><span>Max feasible x</span><strong className="text-slate-900">{pct.format(result.firstMonthMaxExtraFundPct)}</strong></div>
            {extraContributionIsCapped ? (
              <p className="mt-2 text-amber-700">Requested x is above the modeled cash-flow maximum, so contributions are capped at available cash after fixed obligations.</p>
            ) : null}
          </div>
        </div>

        <PercentSlider label="Fund expected annual return" value={form.fundAnnualReturnPct} onChange={(value) => updateField("fundAnnualReturnPct", value)} min={0} max={12} step={0.25} />
        <PercentSlider label="Amazon stock expected annual return" value={form.amazonStockAnnualReturnPct} onChange={(value) => updateField("amazonStockAnnualReturnPct", value)} min={-10} max={20} step={0.5} />

        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Employer match rate" value={form.employerMatchPct} onChange={(value) => updateField("employerMatchPct", value)} helper="50 = $0.50 per $1 contributed." />
          <NumberField label="Match limit %" value={form.employerMatchLimitPct} onChange={(value) => updateField("employerMatchLimitPct", value)} helper="Default 4%." />
        </div>

        <NumberField label="Projection max years" value={form.maxYears} onChange={(value) => updateField("maxYears", value)} />
      </CardContent>
    </Card>
  );
}
