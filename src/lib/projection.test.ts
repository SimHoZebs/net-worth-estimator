import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, DEFAULT_SCENARIO_DEFINITION, buildProjectionInput, getBaseSalaryForMonth, project } from "./projection";

describe("projection engine", () => {
  it("grows salary in year 2", () => {
    const input = buildProjectionInput({
      ...DEFAULT_SCENARIO,
      compensation: {
        ...DEFAULT_SCENARIO.compensation,
        annualRaisePct: 3,
      },
    });

    expect(Math.round(getBaseSalaryForMonth(input, 12))).toBe(Math.round(129000 * 1.03));
  });

  it("routes actual first-month allocation override when enabled", () => {
    const scenario = {
      ...DEFAULT_SCENARIO_DEFINITION,
      horizonMonths: 12,
      allocationPolicies: DEFAULT_SCENARIO_DEFINITION.allocationPolicies.map((policy) => ({
        ...policy,
        overrides: [
          {
            month: 0,
            steps: [
              { destinationAccountId: "studentLoan", destinationDeltaSign: -1 as const, amount: 1234 },
              { destinationAccountId: "taxableFund", destinationDeltaSign: 1 as const, amount: 0 },
            ],
          },
        ],
      })),
    };
    const result = project(scenario);

    expect(result.timeline.monthlyRows[0]?.studentLoanPayment).toBe(1234);
    expect(result.timeline.monthlyRows[0]?.studentLoan).toBeLessThan(0);
    expect(result.timeline.sampledRows.length).toBeGreaterThan(0);
  });

  it("models exactly one year as 12 months and keeps the final point", () => {
    const result = project({
      ...DEFAULT_SCENARIO_DEFINITION,
      horizonMonths: 12,
    });

    expect(result.timeline.monthlyRows[result.timeline.monthlyRows.length - 1]?.month).toBe(11);
    expect(result.timeline.sampledRows.some((row) => row.month === 11)).toBe(true);
  });
});
