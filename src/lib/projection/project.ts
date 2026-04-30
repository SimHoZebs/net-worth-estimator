import { compileProjectionPlan } from "./planCompiler";
import { executeProjectionPlan } from "./runtime";
import { estimateAnnualTaxes } from "./taxes";
import type {
  ProjectionEvent,
  ProjectionResult,
  ProjectionRow,
  ScenarioAccountDefinition,
  RuntimeMonthState,
  RuntimeOperation,
  ScenarioDefinition,
} from "./types";
import { monthLabel } from "./utils";

function sumEventsForMonth(events: ProjectionEvent[], month: number, predicate: (event: ProjectionEvent) => boolean): number {
  return events.reduce((sum, event) => (
    event.month === month && predicate(event) ? sum + event.amount : sum
  ), 0);
}

function sumOperationsForMonth(operations: RuntimeOperation[], month: number, predicate: (operation: RuntimeOperation) => boolean): number {
  return operations.reduce((sum, operation) => (
    operation.month === month && predicate(operation) ? sum + operation.amount : sum
  ), 0);
}

function calculateNetWorth(state: RuntimeMonthState, accounts: ScenarioAccountDefinition[]): number {
  return accounts.reduce((total, account) => {
    if (account.id === "cash") return total;

    const balance = state.balances[account.id] ?? 0;
    return total + (account.kind === "liability" ? -balance : balance);
  }, 0);
}

function createProjectionRow({
  monthState,
  externalEvents,
  accounts,
}: {
  monthState: RuntimeMonthState;
  externalEvents: ProjectionEvent[];
  accounts: ScenarioAccountDefinition[];
}): ProjectionRow {
  const month = monthState.month;
  const fixedExpenses = sumEventsForMonth(externalEvents, month, (event) => event.type === "expense");
  const fixedExpensesForCashFlow = sumOperationsForMonth(monthState.baseOperations, month, (operation) => operation.type === "expense");
  const taxPaid = sumEventsForMonth(externalEvents, month, (event) => event.type === "tax");
  const cashShortfall = sumOperationsForMonth(monthState.shortfallOperations, month, (operation) => operation.type === "shortfall");
  const netWorth = calculateNetWorth(monthState, accounts);

  return {
    month,
    date: monthLabel(month),
    netWorth: Math.round(netWorth),
    accountBalances: { ...monthState.balances },
    taxPaid: Math.round(taxPaid),
    fixedExpenses: Math.round(fixedExpenses),
    fixedExpensesForCashFlow: Math.round(fixedExpensesForCashFlow),
    availableCashBeforeAllocation: Math.round(monthState.availableCashBeforeAllocation),
    allocationMode: monthState.usedAllocationOverride ? "actual" : "projected",
    requestedAllocationAmount: Math.round(monthState.requestedAllocation),
    realizedAllocationAmount: Math.round(monthState.realizedAllocation),
    sweptRemainder: Math.round(monthState.sweptRemainder),
    cashShortfall: Math.round(cashShortfall),
  };
}

export function project(scenario: ScenarioDefinition): ProjectionResult {
  const plan = compileProjectionPlan(scenario);
  const execution = executeProjectionPlan(plan);
  const monthlyRows = execution.monthStates.map((monthState) =>
    createProjectionRow({
      monthState,
      externalEvents: plan.externalEvents,
      accounts: plan.scenario.accounts,
    })
  );
  const lastMonth = monthlyRows[monthlyRows.length - 1]?.month ?? 0;
  const sampledRows = monthlyRows.filter((row) => row.month % 3 === 0 || row.month === lastMonth || row.month === execution.hitTargetMonth);
  const firstYear = plan.annualTaxPlan[0];
  const payoffMonthByLiabilityAccountId = Object.fromEntries(
    plan.scenario.accounts
      .filter((account) => account.kind === "liability")
      .map((account) => [
        account.id,
        account.openingBalance > 0
          ? execution.monthStates.find((state) => (state.balances[account.id] ?? 0) <= 0.01)?.month ?? null
          : null,
      ])
  );
  const totalTaxPaid = monthlyRows.reduce((sum, row) => sum + row.taxPaid, 0);
  const totalUninvestedCash = monthlyRows.reduce((sum, row) => sum + row.sweptRemainder, 0);
  const totalFixedExpenses = monthlyRows.reduce((sum, row) => sum + row.fixedExpenses, 0);
  const totalCashShortfall = monthlyRows.reduce((sum, row) => sum + row.cashShortfall, 0);
  const firstMonthRow = monthlyRows[0];
  const monthlyFixedExpenses = plan.scenario.modules.reduce((sum, module) => (
    module.type === "recurringFlow" && module.eventType === "expense" ? sum + module.amount : sum
  ), 0);

  return {
    timeline: {
      sampledRows,
      monthlyRows,
    },
    taxes: {
      annualPlan: plan.annualTaxPlan,
      firstYear: {
        estimate: firstYear?.taxes ?? estimateAnnualTaxes({ ordinaryIncome: 0, preTax401kContribution: 0 }),
        ordinaryIncome: firstYear?.ordinaryIncome ?? 0,
        federalTaxableIncome: firstYear?.taxes.federalTaxableIncome ?? 0,
        totalTax: firstYear?.taxes.totalTax ?? 0,
        salaryTax: firstYear?.taxAllocatedToSalary ?? 0,
        rsuTax: firstYear?.taxAllocatedToRsus ?? 0,
      },
    },
    events: {
      all: [...plan.externalEvents, ...execution.generatedEvents],
      external: plan.externalEvents,
      generated: execution.generatedEvents,
    },
    milestones: {
      hitTargetMonth: execution.hitTargetMonth,
      payoffMonthByLiabilityAccountId,
    },
    totals: {
      taxPaid: totalTaxPaid,
      uninvestedCash: totalUninvestedCash,
      fixedExpenses: totalFixedExpenses,
      cashShortfall: totalCashShortfall,
      monthlyFixedExpenses,
    },
    cashFlow: {
      firstMonthAvailableCashBeforeAllocation: firstMonthRow?.availableCashBeforeAllocation ?? 0,
      firstMonthRequestedAllocationAmount: firstMonthRow?.requestedAllocationAmount ?? 0,
      firstMonthRealizedAllocationAmount: firstMonthRow?.realizedAllocationAmount ?? 0,
      firstMonthSweptRemainder: firstMonthRow?.sweptRemainder ?? 0,
    },
  };
}
