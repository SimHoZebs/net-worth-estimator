import type { CsvAccount } from "../csvTypes";

export function makeAccount(overrides: Partial<CsvAccount> & { id: string }): CsvAccount {
  return {
    label: overrides.id,
    category: "",
    openingBalance: 0,
    annualRate: 0,
    minBalance: null,
    maxBalance: null,
    color: null,
    enabled: true,
    ...overrides,
  };
}
