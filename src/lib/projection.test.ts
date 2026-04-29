import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, buildProjectionInput, getBaseSalaryForMonth, project } from "./projection";

describe("projection engine", () => {
  it("grows salary in year 2", () => {
    const input = buildProjectionInput({
      ...DEFAULT_SCENARIO,
      compensation: {
        ...DEFAULT_SCENARIO.compensation,
        annualRaisePct: 3,
      },
      overrides: {
        ...DEFAULT_SCENARIO.overrides,
        firstMonth: {
          ...DEFAULT_SCENARIO.overrides.firstMonth,
          useActualPaycheck: false,
        },
      },
      projection: {
        ...DEFAULT_SCENARIO.projection,
        maxYears: 2,
      },
    });

    expect(Math.round(getBaseSalaryForMonth(input, 12))).toBe(Math.round(129000 * 1.03));
  });

  it("routes actual first-month loan payment when override is enabled", () => {
    const input = buildProjectionInput({
      ...DEFAULT_SCENARIO,
      projection: {
        ...DEFAULT_SCENARIO.projection,
        maxYears: 1,
      },
      overrides: {
        ...DEFAULT_SCENARIO.overrides,
        firstMonth: {
          ...DEFAULT_SCENARIO.overrides.firstMonth,
          useActualContributionAllocation: true,
          studentLoanPayment: 1234,
          taxableFundContribution: 0,
        },
      },
    });
    const result = project(input);

    expect(result.timeline.monthlyRows[0]?.studentLoanPayment).toBe(1234);
    expect(result.timeline.monthlyRows[0]?.studentLoan).toBeLessThan(0);
    expect(result.timeline.sampledRows.length).toBeGreaterThan(0);
  });

  it("models exactly one year as 12 months and keeps the final point", () => {
    const input = buildProjectionInput({
      ...DEFAULT_SCENARIO,
      projection: {
        ...DEFAULT_SCENARIO.projection,
        maxYears: 1,
      },
      overrides: {
        ...DEFAULT_SCENARIO.overrides,
        firstMonth: {
          ...DEFAULT_SCENARIO.overrides.firstMonth,
          useActualPaycheck: false,
        },
      },
    });
    const result = project(input);

    expect(result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1]?.month).toBe(11);
    expect(result.timeline.sampledRows.some((row) => row.month === 11)).toBe(true);
  });
});
