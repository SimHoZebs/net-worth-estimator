import { ACCOUNT_CONFIG, EVENT_TYPES } from "./model";
import type {
  AnnualTaxPlanDisplayRow,
  DashboardViewModel,
  EventSummaryRow,
  ProjectionEvent,
  ProjectionResult,
  ProjectionScenario,
} from "./types";
import { monthLabel } from "./utils";

export function summarizeEventsByType(events: ProjectionEvent[]): EventSummaryRow[] {
  return Object.values(EVENT_TYPES)
    .map((type) => ({
      type,
      label: type.replace(/_/g, " "),
      count: events.filter((event) => event.type === type).length,
      amount: events.reduce((sum, event) => (event.type === type ? sum + event.amount : sum), 0),
    }))
    .filter((row) => row.count > 0);
}

function buildAnnualTaxPlanDisplayRows(result: ProjectionResult): AnnualTaxPlanDisplayRow[] {
  return result.taxes.annualPlan
    .slice(0, Math.min(6, result.taxes.annualPlan.length))
    .map((year) => ({
      ...year,
      salaryIncome: Math.round(year.salaryIncome),
      rsuIncome: Math.round(year.rsuIncome),
      ordinaryIncome: Math.round(year.ordinaryIncome),
      preTax401kContribution: Math.round(year.preTax401kContribution),
      taxAllocatedToSalary: Math.round(year.taxAllocatedToSalary),
      taxAllocatedToRsus: Math.round(year.taxAllocatedToRsus),
      totalTax: Math.round(year.taxes.totalTax),
      netRsu: Math.round(year.rsuIncome - year.taxAllocatedToRsus),
    }));
}

export function selectDashboardModel(result: ProjectionResult, scenario: ProjectionScenario): DashboardViewModel {
  const requestedExtraFundContribution = result.cashFlow.firstMonthAfterTaxCashAfter401k * (scenario.strategy.extraInvestmentPct / 100);
  const hitText = result.milestones.hitTargetMonth === null
    ? `Not within ${scenario.projection.maxYears} years`
    : `${Math.floor(result.milestones.hitTargetMonth / 12)} years, ${result.milestones.hitTargetMonth % 12} months`;
  const studentLoanPaidOffText = result.milestones.studentLoanPaidOffMonth === null
    ? "Not within projection"
    : `${Math.floor(result.milestones.studentLoanPaidOffMonth / 12)} years, ${result.milestones.studentLoanPaidOffMonth % 12} months`;

  return {
    chartLabelByKey: Object.fromEntries(Object.entries(ACCOUNT_CONFIG).map(([key, account]) => [key, account.label])) as DashboardViewModel["chartLabelByKey"],
    annualTaxPlan: buildAnnualTaxPlanDisplayRows(result),
    hitText,
    hitDate: result.milestones.hitTargetMonth === null ? "-" : monthLabel(result.milestones.hitTargetMonth),
    studentLoanPaidOffText,
    studentLoanPaidOffDate: result.milestones.studentLoanPaidOffMonth === null ? "-" : monthLabel(result.milestones.studentLoanPaidOffMonth),
    effectiveTaxRate: result.taxes.firstYear.totalTax / Math.max(1, result.taxes.firstYear.ordinaryIncome),
    finalNetWorth: result.timeline.sampledRows[result.timeline.sampledRows.length - 1]?.netWorth ?? 0,
    extraContributionIsCapped: requestedExtraFundContribution > result.cashFlow.firstMonthMaxExtraFundContribution + 1,
  };
}
