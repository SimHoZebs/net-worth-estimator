import { DEFAULT_REFRESHER_PCT_OF_BASE, EMPLOYEE_401K_LIMIT_2026, MODEL } from "./model";
import type { ProjectionInput, ScenarioDefinition } from "./types";
import { getProjectionLastMonth } from "./utils";

export function buildScenarioDefinition(input: ProjectionInput): ScenarioDefinition {
  const projectionLastMonth = getProjectionLastMonth(input.projection.maxYears);
  const taxableFundOpeningBalance = Math.max(
    0,
    input.balances.currentNetWorth - input.balances.current401kBalance - input.balances.currentAmazonStockBalance
  );
  const firstMonthActualAllocationOverride = input.overrides.actualMonthlyOverrides.find((override) => override.month === 0 && override.useActualContributionAllocation);

  return {
    version: 2,
    name: "Built-in module scenario",
    horizonMonths: projectionLastMonth + 1,
    targetNetWorth: input.projection.targetNetWorth,
    accounts: [
      { id: "cash", label: "Cash", kind: "cash", openingBalance: 0, annualRate: 0, minBalance: 0 },
      { id: "k401", label: MODEL.accounts.k401.label, kind: "asset", openingBalance: input.balances.current401kBalance, annualRate: input.market.fundAnnualReturn, color: MODEL.accounts.k401.color, minBalance: 0 },
      { id: "taxableFund", label: MODEL.accounts.taxableFund.label, kind: "asset", openingBalance: taxableFundOpeningBalance, annualRate: input.market.fundAnnualReturn, color: MODEL.accounts.taxableFund.color, minBalance: 0 },
      { id: "amazonStock", label: MODEL.accounts.amazonStock.label, kind: "asset", openingBalance: input.balances.currentAmazonStockBalance, annualRate: input.market.amazonStockAnnualReturn, color: MODEL.accounts.amazonStock.color, minBalance: 0 },
      { id: "studentLoan", label: MODEL.accounts.studentLoan.label, kind: "liability", openingBalance: input.balances.studentLoanBalance, annualRate: input.market.studentLoanInterestRate, color: MODEL.accounts.studentLoan.color, minBalance: 0 },
    ],
    modules: [
      {
        id: "employment",
        type: "employmentIncome",
        annualBaseSalary: input.compensation.baseSalary,
        annualRaiseRate: input.compensation.annualRaiseRate,
        firstMonthActualPaycheck: {
          enabled: input.overrides.firstMonth.useActualPaycheck,
          regularGross: input.overrides.firstMonth.regularGross,
          signingBonus: input.overrides.firstMonth.signingBonus,
          takeHome: input.overrides.firstMonth.takeHome,
        },
      },
      {
        id: "retirement-plan",
        type: "retirementPlan",
        destinationAccountId: "k401",
        annualEmployeeLimit: EMPLOYEE_401K_LIMIT_2026,
        employeeContributionRate: input.strategy.k401ContributionRate,
        employerMatchRate: input.strategy.employerMatchRate,
        employerMatchLimitRate: input.strategy.employerMatchLimitRate,
        firstMonthOverride: {
          enabled: input.overrides.firstMonth.useActualPaycheck,
          employeeContribution: input.overrides.firstMonth.employee401k,
          employerContribution: input.overrides.firstMonth.employer401k,
        },
      },
      {
        id: "rent",
        type: "recurringFlow",
        label: "Rent",
        amount: input.expenses.monthlyRent,
        startMonth: 0,
        endMonth: null,
        eventType: "expense",
        source: "rent",
        taxTreatment: "after-tax",
      },
      {
        id: "parking",
        type: "recurringFlow",
        label: "Parking",
        amount: input.expenses.monthlyParking,
        startMonth: 0,
        endMonth: null,
        eventType: "expense",
        source: "parking",
        taxTreatment: "after-tax",
      },
      {
        id: "health-dental-benefits",
        type: "recurringFlow",
        label: "Health/dental benefits",
        amount: input.expenses.monthlyHealthDentalBenefits,
        startMonth: 0,
        endMonth: null,
        eventType: "expense",
        source: "health-dental-benefits",
        taxTreatment: "after-tax",
        skipWhenActualFirstMonthPaycheck: true,
      },
      {
        id: "other-fixed-expenses",
        type: "recurringFlow",
        label: "Other fixed expenses",
        amount: input.expenses.otherMonthlyFixedExpenses,
        startMonth: 0,
        endMonth: null,
        eventType: "expense",
        source: "other-fixed-expenses",
        taxTreatment: "after-tax",
      },
      {
        id: "equity-grants",
        type: "equityGrantSeries",
        destinationAccountId: "amazonStock",
        employeeMonthsAtProjectionStart: input.compensation.monthsAtAmazon,
        initialGrantValue: input.compensation.initialRsuGrantValue,
        refreshGrantValue: input.compensation.futureAnnualRefreshGrantValue,
        firstRefreshGrantMonth: Math.max(24, input.compensation.monthsAtAmazon + 12),
        refreshFrequencyMonths: 12,
        useSalaryGrowthForRefreshers: input.compensation.useSalaryGrowthForRefreshers,
        annualRaiseRate: input.compensation.annualRaiseRate,
        annualBaseSalary: input.compensation.baseSalary,
        salaryLinkedRefreshPctOfBase: DEFAULT_REFRESHER_PCT_OF_BASE,
        vestingSchedule: MODEL.rsuPlans.amazonInitial.events.map((event) => ({
          monthOffset: event.month,
          pct: event.pct,
        })),
      },
      {
        id: "taxes",
        type: "tax",
      },
    ],
    allocationPolicies: [
      {
        id: "after-tax-allocation",
        sourceAccountId: "cash",
        rateOfAvailable: input.strategy.extraInvestmentRate,
        sweepRemainderFromSource: true,
        steps: input.strategy.payStudentLoanBeforeInvesting
          ? [
              { destinationAccountId: "studentLoan", destinationDeltaSign: -1, mode: "reduceToZero" },
              { destinationAccountId: "taxableFund", destinationDeltaSign: 1, mode: "allRemaining" },
            ]
          : [
              { destinationAccountId: "taxableFund", destinationDeltaSign: 1, mode: "allRemaining" },
            ],
        overrides: firstMonthActualAllocationOverride
          ? [
              {
                month: 0,
                steps: [
                  {
                    destinationAccountId: "studentLoan",
                    destinationDeltaSign: -1,
                    amount: firstMonthActualAllocationOverride.studentLoanPayment,
                  },
                  {
                    destinationAccountId: "taxableFund",
                    destinationDeltaSign: 1,
                    amount: firstMonthActualAllocationOverride.taxableFundContribution,
                  },
                ],
              },
            ]
          : [],
      },
    ],
  };
}
