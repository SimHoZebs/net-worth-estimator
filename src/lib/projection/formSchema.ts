import { pct } from "../format";
import { DEFAULT_REFRESHER_PCT_OF_BASE } from "./model";
import type { ScenarioPath } from "./types";

interface BaseFieldDefinition {
  path: ScenarioPath;
  label: string;
  helper?: string;
  className?: string;
}

export interface NumberFieldDefinition extends BaseFieldDefinition {
  kind: "number";
}

export interface SliderFieldDefinition extends BaseFieldDefinition {
  kind: "slider";
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

export interface CheckboxFieldDefinition extends BaseFieldDefinition {
  kind: "checkbox";
  description: string;
  containerClassName?: string;
}

export type ScenarioFieldDefinition = NumberFieldDefinition | SliderFieldDefinition | CheckboxFieldDefinition;

export const compensationFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["compensation", "baseSalary"], label: "Base salary" },
  {
    kind: "number",
    path: ["compensation", "initialRsuGrantValue"],
    label: "Initial RSU grant value",
    helper: "Default $140k implies $56k/year in years 3-4.",
  },
  {
    kind: "number",
    path: ["compensation", "monthsAtAmazon"],
    label: "Months at Amazon",
    helper: "Used to place remaining initial-grant vests.",
  },
  {
    kind: "number",
    path: ["compensation", "futureAnnualRefreshGrantValue"],
    label: "Future annual refresh grant",
    helper: `Default assumes ${pct.format(DEFAULT_REFRESHER_PCT_OF_BASE)} of base salary/year. Refreshers are discretionary and performance/level dependent.`,
  },
  {
    kind: "number",
    path: ["compensation", "annualRaisePct"],
    label: "Annual raise",
    helper: "Applied to base salary each modeled year. Salary-linked 401(k), match, taxes, and optional refresher sizing follow this.",
  },
];

export const salaryGrowthToggleField: CheckboxFieldDefinition = {
  kind: "checkbox",
  path: ["compensation", "useSalaryGrowthForRefreshers"],
  label: "Scale refreshers with salary",
  description: `Scale future refresh grant as ${pct.format(DEFAULT_REFRESHER_PCT_OF_BASE)} of that year's raised base salary. Turn off to keep the manual future refresh grant fixed every year.`,
};

export const firstMonthPaycheckToggleField: CheckboxFieldDefinition = {
  kind: "checkbox",
  path: ["overrides", "firstMonth", "useActualPaycheck"],
  label: "Use actual first-month paycheck",
  description: "Use actual partial-month paycheck for month 0. This models a partial regular paycheck plus a signing bonus, with benefits already deducted from take-home.",
};

export const firstMonthPaycheckFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["overrides", "firstMonth", "regularGross"], label: "Regular gross" },
  { kind: "number", path: ["overrides", "firstMonth", "signingBonus"], label: "Signing bonus" },
  { kind: "number", path: ["overrides", "firstMonth", "takeHome"], label: "Take home" },
  {
    kind: "number",
    path: ["overrides", "firstMonth", "employee401k"],
    label: "401(k) this paycheck",
    helper: "Set this if a 401(k) line appears on the paycheck.",
  },
  {
    kind: "number",
    path: ["overrides", "firstMonth", "employer401k"],
    label: "Employer 401(k) this paycheck",
    helper: "Set this if the first paycheck already included an employer contribution.",
  },
];

export const firstMonthContributionToggleField: CheckboxFieldDefinition = {
  kind: "checkbox",
  path: ["overrides", "firstMonth", "useActualContributionAllocation"],
  label: "Use actual first-month contribution allocation",
  description: "Use actual first-month loan/fund contributions instead of the projected x% allocation.",
};

export const firstMonthContributionFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["overrides", "firstMonth", "studentLoanPayment"], label: "Actual loan payment" },
  { kind: "number", path: ["overrides", "firstMonth", "taxableFundContribution"], label: "Actual fund contribution" },
];

export const currentBalanceFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["balances", "currentNetWorth"], label: "Current net worth", className: "col-span-2" },
  { kind: "number", path: ["balances", "current401kBalance"], label: "Current 401(k)" },
  { kind: "number", path: ["balances", "currentAmazonStockBalance"], label: "Current AMZN stock" },
];

export const contributionSliderFields: SliderFieldDefinition[] = [
  {
    kind: "slider",
    path: ["strategy", "k401ContributionPct"],
    label: "Pre-tax 401(k) contribution",
    min: 0,
    max: 25,
    step: 0.5,
    suffix: "% of base",
  },
  {
    kind: "slider",
    path: ["strategy", "extraInvestmentPct"],
    label: "Extra fund contribution / debt payoff rate, x",
    min: 0,
    max: 80,
    step: 1,
    suffix: "% of after-tax cash",
  },
];

export const studentLoanFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["balances", "studentLoanBalance"], label: "Loan balance" },
  {
    kind: "number",
    path: ["market", "studentLoanInterestRatePct"],
    label: "Interest rate",
    helper: "Annual rate; compounded monthly in the model.",
  },
];

export const studentLoanPriorityToggleField: CheckboxFieldDefinition = {
  kind: "checkbox",
  path: ["strategy", "payStudentLoanBeforeInvesting"],
  label: "Pay student loan before investing",
  description: "Send the extra contribution to student loans first. Taxable fund investing starts only after the loan is gone.",
};

export const fixedExpenseFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["expenses", "monthlyRent"], label: "Rent" },
  { kind: "number", path: ["expenses", "monthlyParking"], label: "Parking" },
  {
    kind: "number",
    path: ["expenses", "monthlyHealthDentalBenefits"],
    label: "Health/dental benefits",
    helper: "Modeled as monthly after-tax cash obligation.",
  },
  { kind: "number", path: ["expenses", "otherMonthlyFixedExpenses"], label: "Other fixed expenses" },
];

export const returnSliderFields: SliderFieldDefinition[] = [
  {
    kind: "slider",
    path: ["market", "fundAnnualReturnPct"],
    label: "Fund expected annual return",
    min: 0,
    max: 12,
    step: 0.25,
  },
  {
    kind: "slider",
    path: ["market", "amazonStockAnnualReturnPct"],
    label: "Amazon stock expected annual return",
    min: -10,
    max: 20,
    step: 0.5,
  },
];

export const matchFields: NumberFieldDefinition[] = [
  {
    kind: "number",
    path: ["strategy", "employerMatchPct"],
    label: "Employer match rate",
    helper: "50 = $0.50 per $1 contributed.",
  },
  {
    kind: "number",
    path: ["strategy", "employerMatchLimitPct"],
    label: "Match limit %",
    helper: "Default 4%.",
  },
];

export const projectionSettingsFields: NumberFieldDefinition[] = [
  { kind: "number", path: ["projection", "maxYears"], label: "Projection max years" },
];
