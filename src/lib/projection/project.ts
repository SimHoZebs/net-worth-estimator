import { getAnnualReturn } from "./calculations";
import {
  create401kEvents,
  createCompensationEvents,
  createEvent,
  createExpenseEvents,
  getActualMonthOverride,
  groupEventsByMonth,
  sumEvents,
} from "./eventGenerators";
import { ACCOUNT_CONFIG, EVENT_TYPES } from "./model";
import { buildAnnualTaxPlan, createTaxEvents, estimateAnnualTaxes } from "./taxes";
import type {
  AccountKey,
  AnnualTaxPlanYear,
  ContributionMode,
  ProjectionEvent,
  ProjectionInput,
  ProjectionResult,
  ProjectionRow,
} from "./types";
import { getProjectionLastMonth, monthLabel } from "./utils";

interface Balances {
  k401: number;
  taxableFund: number;
  studentLoan: number;
  amazonStock: number;
}

interface MonthlyMetrics {
  preTax401k: number;
  employer401k: number;
  fixedExpenses: number;
  fixedExpensesForCashFlow: number;
  salaryTax: number;
  rsuTax: number;
  taxPaid: number;
  grossRsuVested: number;
  netRsuAdded: number;
  afterTaxCashAfter401k: number;
  maxExtraFundContribution: number;
  maxExtraFundPct: number;
  taxableFundContribution: number;
  contributionMode: ContributionMode;
  requestedExtraContribution: number;
  modeledAvailableExtraContribution: number;
  studentLoanPayment: number;
  studentLoanBalance: number;
  studentLoanInterest: number;
  uninvestedCash: number;
  cashShortfall: number;
  netWorth: number;
}

interface ProcessMonthResult {
  generatedEvents: ProjectionEvent[];
  metrics: MonthlyMetrics;
}

function applyMonthlyReturns(balances: Balances, input: ProjectionInput): ProjectionEvent[] {
  const interestEvents: ProjectionEvent[] = [];

  (Object.keys(ACCOUNT_CONFIG) as AccountKey[]).forEach((accountKey) => {
    const monthlyReturn = Math.pow(1 + getAnnualReturn(accountKey, input), 1 / 12) - 1;

    if (accountKey === "studentLoan") {
      const currentDebt = Math.max(0, -balances.studentLoan);
      const interest = currentDebt * monthlyReturn;
      balances.studentLoan -= interest;

      if (interest > 0) {
        interestEvents.push(
          createEvent({
            month: null,
            type: EVENT_TYPES.INTEREST,
            amount: interest,
            source: "student-loan-interest",
            destination: "studentLoan",
            taxTreatment: "after-tax",
          })
        );
      }

      return;
    }

    balances[accountKey] *= 1 + monthlyReturn;
  });

  return interestEvents;
}

function processMonth({
  month,
  events,
  balances,
  input,
  annualTaxPlan,
}: {
  month: number;
  events: ProjectionEvent[];
  balances: Balances;
  input: ProjectionInput;
  annualTaxPlan: AnnualTaxPlanYear[];
}): ProcessMonthResult {
  const yearPlan = annualTaxPlan[Math.floor(month / 12)];

  const preTax401k = sumEvents(events, (event) => event.type === EVENT_TYPES.PRE_TAX_DEDUCTION && event.destination === "k401");
  const employer401k = sumEvents(events, (event) => event.type === EVENT_TYPES.EMPLOYER_CONTRIBUTION && event.destination === "k401");
  const fixedExpenses = sumEvents(events, (event) => event.type === EVENT_TYPES.EXPENSE);
  const fixedExpensesForCashFlow = month === 0 && input.overrides.firstMonth.useActualPaycheck
    ? Math.max(0, fixedExpenses - input.expenses.monthlyHealthDentalBenefits)
    : fixedExpenses;
  const salaryTax = sumEvents(events, (event) => event.type === EVENT_TYPES.TAX && event.meta?.bucket === "salary");
  const grossRsuVested = sumEvents(events, (event) => event.type === EVENT_TYPES.VEST && event.destination === "amazonStock");
  const rsuTaxRateForYear = yearPlan?.rsuIncome ? yearPlan.taxAllocatedToRsus / yearPlan.rsuIncome : 0;
  const rsuTax = grossRsuVested * rsuTaxRateForYear;
  const netRsuAdded = Math.max(0, grossRsuVested - rsuTax);

  const afterTaxCashAfter401k = month === 0 && input.overrides.firstMonth.useActualPaycheck
    ? input.overrides.firstMonth.takeHome
    : Math.max(
      0,
      sumEvents(events, (event) => event.type === EVENT_TYPES.ORDINARY_INCOME && event.meta?.bucket === "salary") - preTax401k - salaryTax
    );
  const cashAfterFixedExpenses = afterTaxCashAfter401k - fixedExpensesForCashFlow;
  const maxExtraFundContribution = Math.max(0, cashAfterFixedExpenses);
  const maxExtraFundPct = afterTaxCashAfter401k > 0 ? maxExtraFundContribution / afterTaxCashAfter401k : 0;
  const requestedExtraContribution = afterTaxCashAfter401k * input.strategy.extraInvestmentRate;
  const modeledAvailableExtraContribution = Math.min(requestedExtraContribution, maxExtraFundContribution);

  const interestEvents = applyMonthlyReturns(balances, input).map((event) => ({ ...event, month }));
  const studentLoanDebtBeforePayment = Math.max(0, -balances.studentLoan);
  const actualOverride = getActualMonthOverride(input, month);

  let studentLoanPayment: number;
  let taxableFundContribution: number;
  let contributionMode: ContributionMode;

  if (actualOverride?.useActualContributionAllocation) {
    studentLoanPayment = Math.min(
      Math.max(0, actualOverride.studentLoanPayment),
      studentLoanDebtBeforePayment,
      maxExtraFundContribution
    );
    taxableFundContribution = Math.min(
      Math.max(0, actualOverride.taxableFundContribution),
      Math.max(0, maxExtraFundContribution - studentLoanPayment)
    );
    contributionMode = "actual";
  } else {
    studentLoanPayment = input.strategy.payStudentLoanBeforeInvesting
      ? Math.min(modeledAvailableExtraContribution, studentLoanDebtBeforePayment)
      : 0;
    taxableFundContribution = modeledAvailableExtraContribution - studentLoanPayment;
    contributionMode = "projected";
  }

  const totalActualOrModeledExtraContribution = studentLoanPayment + taxableFundContribution;
  const uninvestedCash = Math.max(0, cashAfterFixedExpenses - totalActualOrModeledExtraContribution);
  const cashShortfall = Math.max(0, -cashAfterFixedExpenses);

  balances.k401 += preTax401k + employer401k;
  balances.taxableFund += taxableFundContribution;
  balances.amazonStock += netRsuAdded;
  balances.studentLoan += studentLoanPayment;

  const generatedEvents: ProjectionEvent[] = [
    ...interestEvents,
    createEvent({
      month,
      type: EVENT_TYPES.DEBT_PAYMENT,
      amount: studentLoanPayment,
      source: "after-tax-cash",
      destination: "studentLoan",
      taxTreatment: "after-tax",
    }),
    createEvent({
      month,
      type: EVENT_TYPES.TRANSFER,
      amount: taxableFundContribution,
      source: "after-tax-cash",
      destination: "taxableFund",
      taxTreatment: "after-tax",
    }),
    createEvent({
      month,
      type: EVENT_TYPES.VEST,
      amount: netRsuAdded,
      source: "after-tax-rsu-shares",
      destination: "amazonStock",
      taxTreatment: "after-tax",
      meta: { grossRsuVested, rsuTax },
    }),
  ];

  if (cashShortfall > 0) {
    generatedEvents.push(
      createEvent({
        month,
        type: EVENT_TYPES.SHORTFALL,
        amount: cashShortfall,
        source: "cash-flow-shortfall",
        taxTreatment: "after-tax",
      })
    );
  }

  const netWorth = (Object.keys(ACCOUNT_CONFIG) as AccountKey[]).reduce((sum, key) => sum + balances[key], 0);
  const studentLoanBalance = Math.max(0, -balances.studentLoan);

  return {
    generatedEvents,
    metrics: {
      preTax401k,
      employer401k,
      fixedExpenses,
      fixedExpensesForCashFlow,
      salaryTax,
      rsuTax,
      taxPaid: salaryTax + rsuTax,
      grossRsuVested,
      netRsuAdded,
      afterTaxCashAfter401k,
      maxExtraFundContribution,
      maxExtraFundPct,
      taxableFundContribution,
      contributionMode,
      requestedExtraContribution,
      modeledAvailableExtraContribution,
      studentLoanPayment,
      studentLoanBalance,
      studentLoanInterest: interestEvents.reduce((sum, event) => sum + event.amount, 0),
      uninvestedCash,
      cashShortfall,
      netWorth,
    },
  };
}

function createProjectionRow(month: number, balances: Balances, metrics: MonthlyMetrics): ProjectionRow {
  return {
    month,
    date: monthLabel(month),
    netWorth: Math.round(metrics.netWorth),
    k401: Math.round(balances.k401),
    taxableFund: Math.round(balances.taxableFund),
    amazonStock: Math.round(balances.amazonStock),
    studentLoan: Math.round(balances.studentLoan),
    grossRsuVested: Math.round(metrics.grossRsuVested),
    netRsuAdded: Math.round(metrics.netRsuAdded),
    taxPaid: Math.round(metrics.taxPaid),
    fixedExpenses: Math.round(metrics.fixedExpenses),
    fixedExpensesForCashFlow: Math.round(metrics.fixedExpensesForCashFlow),
    maxExtraFundContribution: Math.round(metrics.maxExtraFundContribution),
    taxableFundContribution: Math.round(metrics.taxableFundContribution),
    contributionMode: metrics.contributionMode,
    requestedExtraContribution: Math.round(metrics.requestedExtraContribution),
    modeledAvailableExtraContribution: Math.round(metrics.modeledAvailableExtraContribution),
    studentLoanPayment: Math.round(metrics.studentLoanPayment),
    studentLoanBalance: Math.round(metrics.studentLoanBalance),
    studentLoanInterest: Math.round(metrics.studentLoanInterest),
    cashShortfall: Math.round(metrics.cashShortfall),
  };
}

export function project(input: ProjectionInput): ProjectionResult {
  const projectionLastMonth = getProjectionLastMonth(input.projection.maxYears);
  const balances: Balances = {
    k401: input.balances.current401kBalance,
    amazonStock: input.balances.currentAmazonStockBalance,
    taxableFund: Math.max(0, input.balances.currentNetWorth - input.balances.current401kBalance - input.balances.currentAmazonStockBalance),
    studentLoan: -Math.max(0, input.balances.studentLoanBalance),
  };

  const compensationEvents = createCompensationEvents(input, projectionLastMonth);
  const expenseEvents = createExpenseEvents(input, projectionLastMonth);
  const contributionModel = create401kEvents(input, projectionLastMonth);
  const preTaxLedgerEvents = [...compensationEvents, ...expenseEvents, ...contributionModel.events];
  const annualTaxPlan = buildAnnualTaxPlan(preTaxLedgerEvents, projectionLastMonth);
  const taxEvents = createTaxEvents(annualTaxPlan);
  const externalEvents = [...preTaxLedgerEvents, ...taxEvents];
  const eventsByMonth = groupEventsByMonth(externalEvents);

  const sampledRows: ProjectionRow[] = [];
  const monthlyRows: ProjectionRow[] = [];
  const generatedEvents: ProjectionEvent[] = [];
  let hitTargetMonth: number | null = null;
  let studentLoanPaidOffMonth: number | null = null;
  let totalTaxPaid = 0;
  let totalGrossRsuVested = 0;
  let totalNetRsuAdded = 0;
  let totalFundContributions = 0;
  let totalStudentLoanPayments = 0;
  let totalStudentLoanInterest = 0;
  let totalUninvestedCash = 0;
  let totalFixedExpenses = 0;
  let totalCashShortfall = 0;
  let firstMonthAfterTaxCashAfter401k = 0;
  let firstMonthMaxExtraFundContribution = 0;
  let firstMonthMaxExtraFundPct = 0;

  for (let month = 0; month <= projectionLastMonth; month += 1) {
    const events = eventsByMonth.get(month) ?? [];
    const { generatedEvents: monthGeneratedEvents, metrics } = processMonth({
      month,
      events,
      balances,
      input,
      annualTaxPlan,
    });

    generatedEvents.push(...monthGeneratedEvents);

    if (month === 0) {
      firstMonthAfterTaxCashAfter401k = metrics.afterTaxCashAfter401k;
      firstMonthMaxExtraFundContribution = metrics.maxExtraFundContribution;
      firstMonthMaxExtraFundPct = metrics.maxExtraFundPct;
    }

    totalTaxPaid += metrics.taxPaid;
    totalGrossRsuVested += metrics.grossRsuVested;
    totalNetRsuAdded += metrics.netRsuAdded;
    totalFundContributions += metrics.taxableFundContribution;
    totalStudentLoanPayments += metrics.studentLoanPayment;
    totalStudentLoanInterest += metrics.studentLoanInterest;
    totalUninvestedCash += metrics.uninvestedCash;
    totalFixedExpenses += metrics.fixedExpenses;
    totalCashShortfall += metrics.cashShortfall;

    if (studentLoanPaidOffMonth === null && input.balances.studentLoanBalance > 0 && metrics.studentLoanBalance <= 0.01) {
      studentLoanPaidOffMonth = month;
    }

    const row = createProjectionRow(month, balances, metrics);
    monthlyRows.push(row);

    const isQuarterBoundary = month % 3 === 0;
    const isLastMonth = month === projectionLastMonth;
    const hitTargetThisMonth = metrics.netWorth >= input.projection.targetNetWorth;

    if (isQuarterBoundary || isLastMonth || hitTargetThisMonth) {
      sampledRows.push(row);
    }

    if (hitTargetThisMonth && hitTargetMonth === null) {
      hitTargetMonth = month;
      break;
    }
  }

  const allEvents = [...externalEvents, ...generatedEvents];
  const firstYear = annualTaxPlan[0];

  return {
    timeline: {
      sampledRows,
      monthlyRows,
    },
    taxes: {
      annualPlan: annualTaxPlan,
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
      all: allEvents,
      external: externalEvents,
      generated: generatedEvents,
      rsuVest: compensationEvents.filter((event) => event.type === EVENT_TYPES.VEST),
    },
    contributions: {
      annualEmployee401k: contributionModel.annualEmployee401k,
      annualEmployer401k: contributionModel.annualEmployer401k,
      monthlyEmployee401k: contributionModel.monthlyEmployee401k,
      monthlyEmployer401k: contributionModel.monthlyEmployer401k,
    },
    milestones: {
      hitTargetMonth,
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
      monthlyFixedExpenses: input.expenses.monthlyRent + input.expenses.monthlyParking + input.expenses.monthlyHealthDentalBenefits + input.expenses.otherMonthlyFixedExpenses,
    },
    cashFlow: {
      firstMonthAfterTaxCashAfter401k,
      firstMonthMaxExtraFundContribution,
      firstMonthMaxExtraFundPct,
    },
  };
}
