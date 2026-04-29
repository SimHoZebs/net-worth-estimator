import { compileProjectionPlan } from "./planCompiler";
import { executeProjectionPlan } from "./runtime";
import { estimateAnnualTaxes } from "./taxes";
import type {
  AnnualTaxPlanYear,
  ProjectionEvent,
  ProjectionResult,
  ProjectionRow,
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

function getRsuTaxRateForYear(yearPlan: AnnualTaxPlanYear | undefined): number {
  return yearPlan && yearPlan.rsuIncome > 0 ? yearPlan.taxAllocatedToRsus / yearPlan.rsuIncome : 0;
}

function calculateNetWorth(state: RuntimeMonthState): number {
  const k401 = state.balances.k401 ?? 0;
  const taxableFund = state.balances.taxableFund ?? 0;
  const amazonStock = state.balances.amazonStock ?? 0;
  const studentLoan = state.balances.studentLoan ?? 0;

  return k401 + taxableFund + amazonStock - studentLoan;
}

function createProjectionRow({
  monthState,
  externalEvents,
  annualTaxPlan,
  extraInvestmentRate,
}: {
  monthState: RuntimeMonthState;
  externalEvents: ProjectionEvent[];
  annualTaxPlan: AnnualTaxPlanYear[];
  extraInvestmentRate: number;
}): ProjectionRow {
  const month = monthState.month;
  const yearPlan = annualTaxPlan[Math.floor(month / 12)];
  const grossRsuVested = sumEventsForMonth(
    externalEvents,
    month,
    (event) => event.type === "vest" && event.destination === "amazonStock" && event.taxTreatment === "ordinary-income"
  );
  const rsuTax = grossRsuVested * getRsuTaxRateForYear(yearPlan);
  const netRsuAdded = sumOperationsForMonth(
    monthState.baseOperations,
    month,
    (operation) => operation.type === "vest" && operation.destination === "amazonStock" && operation.taxTreatment === "after-tax"
  );
  const fixedExpenses = sumEventsForMonth(externalEvents, month, (event) => event.type === "expense");
  const fixedExpensesForCashFlow = sumOperationsForMonth(monthState.baseOperations, month, (operation) => operation.type === "expense");
  const salaryTax = sumEventsForMonth(
    externalEvents,
    month,
    (event) => event.type === "tax" && event.meta?.bucket === "salary"
  );
  const afterTaxCashAfter401k = sumOperationsForMonth(
    monthState.baseOperations,
    month,
    (operation) => operation.type === "ordinary_income" && operation.source === "after-tax-salary-cash"
  );
  const requestedExtraContribution = afterTaxCashAfter401k * extraInvestmentRate;
  const modeledAvailableExtraContribution = Math.min(requestedExtraContribution, monthState.availableCashBeforeAllocation);
  const taxableFundContribution = sumOperationsForMonth(
    monthState.policyOperations,
    month,
    (operation) => operation.type === "transfer" && operation.destination === "taxableFund"
  );
  const studentLoanPayment = sumOperationsForMonth(
    monthState.policyOperations,
    month,
    (operation) => operation.type === "debt_payment" && operation.destination === "studentLoan"
  );
  const studentLoanInterest = sumOperationsForMonth(
    monthState.rateRuleOperations,
    month,
    (operation) => operation.type === "interest" && operation.destination === "studentLoan"
  );
  const cashShortfall = sumOperationsForMonth(monthState.shortfallOperations, month, (operation) => operation.type === "shortfall");
  const netWorth = calculateNetWorth(monthState);

  return {
    month,
    date: monthLabel(month),
    netWorth: Math.round(netWorth),
    accountBalances: { ...monthState.balances },
    k401: Math.round(monthState.balances.k401 ?? 0),
    taxableFund: Math.round(monthState.balances.taxableFund ?? 0),
    amazonStock: Math.round(monthState.balances.amazonStock ?? 0),
    studentLoan: Math.round(-(monthState.balances.studentLoan ?? 0)),
    grossRsuVested: Math.round(grossRsuVested),
    netRsuAdded: Math.round(netRsuAdded),
    taxPaid: Math.round(salaryTax + rsuTax),
    fixedExpenses: Math.round(fixedExpenses),
    fixedExpensesForCashFlow: Math.round(fixedExpensesForCashFlow),
    maxExtraFundContribution: Math.round(monthState.availableCashBeforeAllocation),
    taxableFundContribution: Math.round(taxableFundContribution),
    contributionMode: monthState.usedAllocationOverride ? "actual" : "projected",
    requestedExtraContribution: Math.round(requestedExtraContribution),
    modeledAvailableExtraContribution: Math.round(modeledAvailableExtraContribution),
    studentLoanPayment: Math.round(studentLoanPayment),
    studentLoanBalance: Math.round(monthState.balances.studentLoan ?? 0),
    studentLoanInterest: Math.round(studentLoanInterest),
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
      annualTaxPlan: plan.annualTaxPlan,
      extraInvestmentRate: plan.scenario.allocationPolicies[0]?.rateOfAvailable ?? 0,
    })
  );
  const lastMonth = monthlyRows[monthlyRows.length - 1]?.month ?? 0;
  const sampledRows = monthlyRows.filter((row) => row.month % 3 === 0 || row.month === lastMonth || row.month === execution.hitTargetMonth);
  const firstYear = plan.annualTaxPlan[0];
  const studentLoanAccount = plan.scenario.accounts.find((account) => account.id === "studentLoan");
  const studentLoanPaidOffMonth = studentLoanAccount && studentLoanAccount.openingBalance > 0
    ? execution.monthStates.find((state) => (state.balances.studentLoan ?? 0) <= 0.01)?.month ?? null
    : null;
  const totalTaxPaid = monthlyRows.reduce((sum, row) => sum + row.taxPaid, 0);
  const totalGrossRsuVested = monthlyRows.reduce((sum, row) => sum + row.grossRsuVested, 0);
  const totalNetRsuAdded = monthlyRows.reduce((sum, row) => sum + row.netRsuAdded, 0);
  const totalFundContributions = monthlyRows.reduce((sum, row) => sum + row.taxableFundContribution, 0);
  const totalStudentLoanPayments = monthlyRows.reduce((sum, row) => sum + row.studentLoanPayment, 0);
  const totalStudentLoanInterest = monthlyRows.reduce((sum, row) => sum + row.studentLoanInterest, 0);
  const totalUninvestedCash = execution.monthStates.reduce((sum, state) => sum + state.sweptRemainder, 0);
  const totalFixedExpenses = monthlyRows.reduce((sum, row) => sum + row.fixedExpenses, 0);
  const totalCashShortfall = monthlyRows.reduce((sum, row) => sum + row.cashShortfall, 0);
  const firstMonthRow = monthlyRows[0];
  const monthlyFixedExpenses = plan.scenario.modules.reduce((sum, module) => (
    module.type === "recurringFlow" && module.eventType === "expense" ? sum + module.amount : sum
  ), 0);
  const firstMonthAfterTaxCashAfter401k = sumOperationsForMonth(
    execution.monthStates[0]?.baseOperations ?? [],
    0,
    (operation) => operation.type === "ordinary_income" && operation.source === "after-tax-salary-cash"
  );
  const firstMonthMaxExtraFundPct = firstMonthAfterTaxCashAfter401k > 0
    ? (firstMonthRow?.maxExtraFundContribution ?? 0) / firstMonthAfterTaxCashAfter401k
    : 0;

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
      rsuVest: plan.externalEvents.filter((event) => event.type === "vest" && event.taxTreatment === "ordinary-income"),
    },
    contributions: {
      annualEmployee401k: plan.contributionSummary.annualEmployee401k,
      annualEmployer401k: plan.contributionSummary.annualEmployer401k,
      monthlyEmployee401k: plan.contributionSummary.monthlyEmployee401k,
      monthlyEmployer401k: plan.contributionSummary.monthlyEmployer401k,
    },
    milestones: {
      hitTargetMonth: execution.hitTargetMonth,
      studentLoanPaidOffMonth,
    },
    totals: {
      taxPaid: totalTaxPaid,
      grossRsuVested: totalGrossRsuVested,
      netRsuAdded: totalNetRsuAdded,
      fundContributions: totalFundContributions,
      studentLoanPayments: totalStudentLoanPayments,
      studentLoanInterest: totalStudentLoanInterest,
      uninvestedCash: totalUninvestedCash,
      fixedExpenses: totalFixedExpenses,
      cashShortfall: totalCashShortfall,
      monthlyFixedExpenses,
    },
    cashFlow: {
      firstMonthAfterTaxCashAfter401k,
      firstMonthMaxExtraFundContribution: firstMonthRow?.maxExtraFundContribution ?? 0,
      firstMonthMaxExtraFundPct,
    },
  };
}
