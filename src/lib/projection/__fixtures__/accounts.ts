import type { Account } from "../types/scenario";

export function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    label: overrides.id,
    category: "",
    annualRate: 0,
    volatility: 0,
    minBalance: null,
    maxBalance: null,
    color: null,
    enabled: true,
    ...overrides,
  };
}
