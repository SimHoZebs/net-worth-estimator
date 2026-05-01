import type { CsvPosting } from "../csvTypes";

export function makePosting(overrides: Partial<CsvPosting> & { id: string }): CsvPosting {
  return {
    label: overrides.id,
    sourceAccountId: null,
    destinations: null,
    amountMode: "fixed",
    basePostingId: null,
    absBase: false,
    amount: 0,
    annualGrowthRate: 0,
    startDate: "2026-01-01",
    endDate: null,
    annualCap: null,
    priority: 1,
    enabled: true,
    ...overrides,
  };
}
