import type { CsvAccount } from "../types/csv";

const DAYS_PER_YEAR = 365;

export function initAccountBalances(accounts: CsvAccount[]): Record<string, number> {
  return Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]));
}

export function snapshotBalances(balances: Record<string, number>): Record<string, number> {
  return { ...balances };
}

export function computeNetWorth(balances: Record<string, number>, accounts: CsvAccount[]): number {
  return accounts.reduce((total, account) => {
    if (!account.enabled) {
      return total;
    }

    return total + (balances[account.id] ?? 0);
  }, 0);
}

function applyYearlyGrowth(
  balance: number,
  rates: number[],
  startOffsetDays: number,
  daysElapsed: number
): number {
  let remainingDays = daysElapsed;
  let currentOffset = startOffsetDays;
  let currentBalance = balance;

  while (remainingDays > 0) {
    const yearIndex = Math.floor(currentOffset / DAYS_PER_YEAR);
    if (yearIndex < 0 || yearIndex >= rates.length) {
      break;
    }

    const daysInYearRemaining = DAYS_PER_YEAR - (currentOffset % DAYS_PER_YEAR);
    const daysToApply = Math.min(remainingDays, daysInYearRemaining);
    const rate = rates[yearIndex];

    currentBalance = currentBalance * Math.pow(1 + rate, daysToApply / DAYS_PER_YEAR);
    currentOffset += daysToApply;
    remainingDays -= daysToApply;
  }

  return currentBalance - balance;
}

export function applyGrowth(
  balances: Record<string, number>,
  accounts: CsvAccount[],
  daysElapsed: number,
  fromDate?: string,
  projectionStartDate?: string,
  stochasticRates?: Map<string, number[]>
): number {
  if (daysElapsed <= 0) {
    return 0;
  }

  const hasStochastic = stochasticRates !== undefined && fromDate !== undefined && projectionStartDate !== undefined;
  let startOffsetDays = 0;

  if (hasStochastic) {
    const fromTime = new Date(`${fromDate}T00:00:00Z`).getTime();
    const startTime = new Date(`${projectionStartDate}T00:00:00Z`).getTime();
    startOffsetDays = Math.round((fromTime - startTime) / (24 * 60 * 60 * 1000));
  }

  let growthNetWorthImpact = 0;

  accounts.forEach((account) => {
    const currentBalance = balances[account.id] ?? 0;
    if (currentBalance === 0) {
      return;
    }

    let growthAmount = 0;

    if (hasStochastic) {
      const rates = stochasticRates.get(account.id);
      if (rates && rates.length > 0) {
        growthAmount = applyYearlyGrowth(currentBalance, rates, startOffsetDays, daysElapsed);
      } else if (account.annualRate !== 0) {
        growthAmount = currentBalance * (Math.pow(1 + account.annualRate, daysElapsed / DAYS_PER_YEAR) - 1);
      }
    } else if (account.annualRate !== 0) {
      growthAmount = currentBalance * (Math.pow(1 + account.annualRate, daysElapsed / DAYS_PER_YEAR) - 1);
    }

    balances[account.id] = currentBalance + growthAmount;
    growthNetWorthImpact += growthAmount;
  });

  return growthNetWorthImpact;
}

export function getWithdrawableAmount(
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>,
  accountId: string
): number {
  const account = accountById.get(accountId);
  if (!account) {
    return 0;
  }

  return Math.max(0, (balances[accountId] ?? 0) - (account.minBalance ?? 0));
}

export function getHeadroom(
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>,
  accountId: string
): number {
  const account = accountById.get(accountId);
  if (!account) {
    return 0;
  }

  return Math.max(0, (account.maxBalance ?? Number.POSITIVE_INFINITY) - (balances[accountId] ?? 0));
}

export function getTotalDestinationHeadroom(
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>,
  destIds: string[]
): number {
  return destIds.reduce((total, destId) => {
    const account = accountById.get(destId);
    if (!account) {
      return total;
    }

    return total + Math.max(0, (account.maxBalance ?? Number.POSITIVE_INFINITY) - (balances[destId] ?? 0));
  }, 0);
}
