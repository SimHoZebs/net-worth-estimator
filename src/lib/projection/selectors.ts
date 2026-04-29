import { EVENT_TYPES } from "./model";
import type {
  AnnualTaxPlanDisplayRow,
  DashboardViewModel,
  EventSummaryRow,
  ProjectionEvent,
  ProjectionResult,
  ScenarioDefinition,
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

export function selectDashboardModel(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel {
  const hitText = result.milestones.hitTargetMonth === null
    ? `Not within ${Math.max(1, Math.round(scenario.horizonMonths / 12))} years`
    : `${Math.floor(result.milestones.hitTargetMonth / 12)} years, ${result.milestones.hitTargetMonth % 12} months`;

  return {
    accountLabelsById: Object.fromEntries(scenario.accounts.map((account) => [account.id, account.label])),
    accountColorsById: Object.fromEntries(scenario.accounts.map((account) => [account.id, account.color ?? "#64748b"])),
    assetAccountIds: scenario.accounts.filter((account) => account.kind === "asset").map((account) => account.id),
    liabilityAccountIds: scenario.accounts.filter((account) => account.kind === "liability").map((account) => account.id),
    hitText,
    hitDate: result.milestones.hitTargetMonth === null ? "-" : monthLabel(result.milestones.hitTargetMonth),
    effectiveTaxRate: result.taxes.firstYear.totalTax / Math.max(1, result.taxes.firstYear.ordinaryIncome),
    finalNetWorth: result.timeline.sampledRows[result.timeline.sampledRows.length - 1]?.netWorth ?? 0,
    totalAccounts: scenario.accounts.length,
    totalModules: scenario.modules.length,
    totalPolicies: scenario.allocationPolicies.length,
  };
}
