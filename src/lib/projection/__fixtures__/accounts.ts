import type { Account } from "../types/scenario";

export function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    label: overrides.id,
    minBalance: null,
    maxBalance: null,
    color: null,
    enabled: true,
    ...overrides,
  };
}
