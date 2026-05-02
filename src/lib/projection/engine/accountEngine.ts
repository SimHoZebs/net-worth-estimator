import type { Account } from "../types/scenario";

export function initAccountBalances(accounts: Account[]): Record<string, number> {
  return Object.fromEntries(accounts.map((account) => [account.id, 0]));
}

export function snapshotBalances(balances: Record<string, number>): Record<string, number> {
  return { ...balances };
}

export function computeNetWorth(balances: Record<string, number>, accounts: Account[]): number {
  return accounts.reduce((total, account) => {
    if (!account.enabled) {
      return total;
    }

    return total + (balances[account.id] ?? 0);
  }, 0);
}

export function getWithdrawableAmount(
  balances: Record<string, number>,
  accountById: Map<string, Account>,
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
  accountById: Map<string, Account>,
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
  accountById: Map<string, Account>,
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
