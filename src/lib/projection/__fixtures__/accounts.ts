import { NO_FLOOR, NO_CEILING } from "../constants";
import type { Account } from "../types/scenario";

export function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    label: overrides.id,
    minBalance: NO_FLOOR,
    maxBalance: NO_CEILING,
    color: null,
    enabled: true,
    ...overrides,
  };
}
