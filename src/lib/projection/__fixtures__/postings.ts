import type { Posting } from "../types/scenario";

export function makePosting(overrides: Partial<Posting> & { id: string }): Posting {
  return {
    label: overrides.id,
    sourceAccountId: null,
    destinations: null,
    arithmetic: "0",
    frequency: "monthly",
    annualRate: 0,
    annualGrowthRate: 0,
    volatility: 0,
    startDate: "2026-01-01",
    endDate: null,
    annualCap: null,
    priority: 1,
    enabled: true,
    ...overrides,
  };
}
