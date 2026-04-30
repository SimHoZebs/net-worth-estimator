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

function sumEventAmounts(events: ProjectionEvent[], predicate: (event: ProjectionEvent) => boolean): number {
  return events.reduce((sum, event) => (predicate(event) ? sum + event.amount : sum), 0);
}

function buildEndingBalanceRows(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel["endingBalanceRows"] {
  const finalRow = result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1];

  return scenario.accounts
    .filter((account) => account.id !== "cash")
    .map((account) => {
      const currentBalance = finalRow?.accountBalances[account.id] ?? account.openingBalance;

      return {
        accountId: account.id,
        label: account.label,
        color: account.color ?? "#64748b",
        kind: account.kind,
        openingBalance: account.openingBalance,
        currentBalance,
        signedBalance: account.kind === "liability" ? -currentBalance : currentBalance,
      };
    });
}

function buildLiabilityRows(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel["liabilityRows"] {
  const finalRow = result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1];

  return scenario.accounts
    .filter((account) => account.kind === "liability")
    .map((account) => ({
      accountId: account.id,
      label: account.label,
      payoffMonth: result.milestones.payoffMonthByLiabilityAccountId[account.id] ?? null,
      payoffDate: result.milestones.payoffMonthByLiabilityAccountId[account.id] === null || result.milestones.payoffMonthByLiabilityAccountId[account.id] === undefined
        ? "-"
        : monthLabel(result.milestones.payoffMonthByLiabilityAccountId[account.id] as number),
      currentBalance: finalRow?.accountBalances[account.id] ?? account.openingBalance,
      totalInterest: sumEventAmounts(result.events.all, (event) => event.type === "interest" && event.destination === account.id),
      totalDebtPayments: sumEventAmounts(result.events.all, (event) => event.type === "debt_payment" && event.destination === account.id),
    }))
    .filter((row) => row.currentBalance > 0 || row.totalInterest > 0 || row.totalDebtPayments > 0);
}

function buildRetirementRows(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel["retirementRows"] {
  const rowsByAccountId = new Map<string, DashboardViewModel["retirementRows"][number]>();

  scenario.accounts.forEach((account) => {
    rowsByAccountId.set(account.id, {
      accountId: account.id,
      label: account.label,
      annualEmployeeContribution: 0,
      annualEmployerContribution: 0,
      firstMonthEmployeeContribution: 0,
      firstMonthEmployerContribution: 0,
    });
  });

  result.events.external.forEach((event) => {
    if (!event.destination) return;
    const row = rowsByAccountId.get(event.destination);
    if (!row) return;

    if (event.type === "pre_tax_deduction") {
      if ((event.month ?? Number.POSITIVE_INFINITY) < 12) row.annualEmployeeContribution += event.amount;
      if (event.month === 0) row.firstMonthEmployeeContribution += event.amount;
    }

    if (event.type === "employer_contribution") {
      if ((event.month ?? Number.POSITIVE_INFINITY) < 12) row.annualEmployerContribution += event.amount;
      if (event.month === 0) row.firstMonthEmployerContribution += event.amount;
    }
  });

  return Array.from(rowsByAccountId.values()).filter((row) => (
    row.annualEmployeeContribution > 0 || row.annualEmployerContribution > 0 || row.firstMonthEmployeeContribution > 0 || row.firstMonthEmployerContribution > 0
  ));
}

function buildEquityRows(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel["equityRows"] {
  return scenario.accounts
    .map((account) => ({
      accountId: account.id,
      label: account.label,
      grossVested: sumEventAmounts(result.events.external, (event) => event.type === "vest" && event.taxTreatment === "ordinary-income" && event.destination === account.id),
      netAdded: sumEventAmounts(result.events.generated, (event) => event.type === "vest" && event.taxTreatment === "after-tax" && event.destination === account.id),
    }))
    .filter((row) => row.grossVested > 0 || row.netAdded > 0);
}

function buildAllocationRows(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel["allocationRows"] {
  return scenario.accounts
    .filter((account) => account.id !== "cash")
    .map((account) => ({
      accountId: account.id,
      label: account.label,
      totalTransfersIn: sumEventAmounts(result.events.all, (event) => event.type === "transfer" && event.destination === account.id),
      totalDebtReduction: sumEventAmounts(result.events.all, (event) => event.type === "debt_payment" && event.destination === account.id),
    }))
    .filter((row) => row.totalTransfersIn > 0 || row.totalDebtReduction > 0);
}

export function selectDashboardModel(result: ProjectionResult, scenario: ScenarioDefinition): DashboardViewModel {
  const hitText = result.milestones.hitTargetMonth === null
    ? `Not within ${Math.max(1, Math.round(scenario.horizonMonths / 12))} years`
    : `${Math.floor(result.milestones.hitTargetMonth / 12)} years, ${result.milestones.hitTargetMonth % 12} months`;
  const endingBalanceRows = buildEndingBalanceRows(result, scenario);

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
    endingBalanceRows,
    liabilityRows: buildLiabilityRows(result, scenario),
    retirementRows: buildRetirementRows(result, scenario),
    equityRows: buildEquityRows(result, scenario),
    allocationRows: buildAllocationRows(result, scenario),
  };
}

export { buildAnnualTaxPlanDisplayRows };
