import { ACCOUNT_CONFIG, DEFAULT_REFRESHER_PCT_OF_BASE, EMPLOYEE_401K_LIMIT_2026 } from "./model";
import type { AccountKey, ProjectionInput } from "./types";
import { getYearIndex } from "./utils";

export function getBaseSalaryForMonth(input: ProjectionInput, month: number): number {
  return input.compensation.baseSalary * Math.pow(1 + input.compensation.annualRaiseRate, getYearIndex(month));
}

export function getMonthlyBaseSalary(input: ProjectionInput, month: number): number {
  return getBaseSalaryForMonth(input, month) / 12;
}

export function getAnnual401kEmployeeForMonth(input: ProjectionInput, month: number): number {
  return Math.min(getBaseSalaryForMonth(input, month) * input.strategy.k401ContributionRate, EMPLOYEE_401K_LIMIT_2026);
}

export function getAnnual401kEmployerForMonth(input: ProjectionInput, month: number): number {
  return getBaseSalaryForMonth(input, month) * Math.min(input.strategy.k401ContributionRate, input.strategy.employerMatchLimitRate) * input.strategy.employerMatchRate;
}

export function getFutureRefreshGrantValueForMonth(input: ProjectionInput, month: number): number {
  if (!input.compensation.useSalaryGrowthForRefreshers) return input.compensation.futureAnnualRefreshGrantValue;
  return getBaseSalaryForMonth(input, month) * DEFAULT_REFRESHER_PCT_OF_BASE;
}

export function getAnnualReturn(accountKey: AccountKey, input: ProjectionInput): number {
  switch (ACCOUNT_CONFIG[accountKey].annualReturnSource) {
    case "amazonStockAnnualReturn":
      return input.market.amazonStockAnnualReturn;
    case "studentLoanInterestRate":
      return input.market.studentLoanInterestRate;
    case "fundAnnualReturn":
    default:
      return input.market.fundAnnualReturn;
  }
}
