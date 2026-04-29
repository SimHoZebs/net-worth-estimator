import { DEFAULT_REFRESHER_PCT_OF_BASE } from "../model";
import type { ProjectionScenario } from "../types";

export const DEFAULT_SCENARIO: ProjectionScenario = {
  compensation: {
    baseSalary: 129000,
    initialRsuGrantValue: 140000,
    monthsAtAmazon: 24,
    futureAnnualRefreshGrantValue: Math.round(129000 * DEFAULT_REFRESHER_PCT_OF_BASE),
    annualRaisePct: 3,
    useSalaryGrowthForRefreshers: true,
  },
  balances: {
    currentNetWorth: 50000,
    current401kBalance: 10000,
    currentAmazonStockBalance: 0,
    studentLoanBalance: 60000,
  },
  strategy: {
    extraInvestmentPct: 15,
    k401ContributionPct: 4,
    employerMatchPct: 50,
    employerMatchLimitPct: 4,
    payStudentLoanBeforeInvesting: true,
  },
  market: {
    fundAnnualReturnPct: 5,
    amazonStockAnnualReturnPct: 5,
    studentLoanInterestRatePct: 13,
  },
  expenses: {
    monthlyRent: 2578,
    monthlyParking: 275,
    monthlyHealthDentalBenefits: 500,
    otherMonthlyFixedExpenses: 0,
  },
  projection: {
    maxYears: 50,
  },
  overrides: {
    firstMonth: {
      useActualPaycheck: true,
      regularGross: 9283.83,
      signingBonus: 50100,
      takeHome: 41330.61,
      employee401k: 0,
      employer401k: 0,
      useActualContributionAllocation: false,
      studentLoanPayment: 0,
      taxableFundContribution: 0,
    },
  },
};
