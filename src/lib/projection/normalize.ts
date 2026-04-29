import { MODEL } from "./model";
import type { ProjectionInput, ProjectionScenario } from "./types";
import { clampNumber } from "./utils";

export function buildProjectionInput(scenario: ProjectionScenario): ProjectionInput {
  return {
    compensation: {
      baseSalary: clampNumber(scenario.compensation.baseSalary),
      initialRsuGrantValue: clampNumber(scenario.compensation.initialRsuGrantValue),
      monthsAtAmazon: clampNumber(scenario.compensation.monthsAtAmazon),
      futureAnnualRefreshGrantValue: clampNumber(scenario.compensation.futureAnnualRefreshGrantValue),
      annualRaiseRate: clampNumber(scenario.compensation.annualRaisePct) / 100,
      useSalaryGrowthForRefreshers: scenario.compensation.useSalaryGrowthForRefreshers,
    },
    balances: {
      currentNetWorth: clampNumber(scenario.balances.currentNetWorth),
      current401kBalance: clampNumber(scenario.balances.current401kBalance),
      currentAmazonStockBalance: clampNumber(scenario.balances.currentAmazonStockBalance),
      studentLoanBalance: clampNumber(scenario.balances.studentLoanBalance),
    },
    strategy: {
      extraInvestmentRate: clampNumber(scenario.strategy.extraInvestmentPct) / 100,
      k401ContributionRate: clampNumber(scenario.strategy.k401ContributionPct) / 100,
      employerMatchRate: clampNumber(scenario.strategy.employerMatchPct) / 100,
      employerMatchLimitRate: clampNumber(scenario.strategy.employerMatchLimitPct) / 100,
      payStudentLoanBeforeInvesting: scenario.strategy.payStudentLoanBeforeInvesting,
    },
    market: {
      fundAnnualReturn: clampNumber(scenario.market.fundAnnualReturnPct) / 100,
      amazonStockAnnualReturn: clampNumber(scenario.market.amazonStockAnnualReturnPct) / 100,
      studentLoanInterestRate: clampNumber(scenario.market.studentLoanInterestRatePct) / 100,
    },
    expenses: {
      monthlyRent: clampNumber(scenario.expenses.monthlyRent),
      monthlyParking: clampNumber(scenario.expenses.monthlyParking),
      monthlyHealthDentalBenefits: clampNumber(scenario.expenses.monthlyHealthDentalBenefits),
      otherMonthlyFixedExpenses: clampNumber(scenario.expenses.otherMonthlyFixedExpenses),
    },
    projection: {
      maxYears: clampNumber(scenario.projection.maxYears, 50),
      targetNetWorth: MODEL.targetNetWorth,
    },
    overrides: {
      firstMonth: {
        useActualPaycheck: scenario.overrides.firstMonth.useActualPaycheck,
        regularGross: clampNumber(scenario.overrides.firstMonth.regularGross),
        signingBonus: clampNumber(scenario.overrides.firstMonth.signingBonus),
        takeHome: clampNumber(scenario.overrides.firstMonth.takeHome),
        employee401k: clampNumber(scenario.overrides.firstMonth.employee401k),
        employer401k: clampNumber(scenario.overrides.firstMonth.employer401k),
      },
      actualMonthlyOverrides: [
        {
          month: 0,
          label: "Actual first month",
          useActualContributionAllocation: scenario.overrides.firstMonth.useActualContributionAllocation,
          studentLoanPayment: clampNumber(scenario.overrides.firstMonth.studentLoanPayment),
          taxableFundContribution: clampNumber(scenario.overrides.firstMonth.taxableFundContribution),
        },
      ],
    },
  };
}
