import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_STATE, buildAssumptionsFromState, getBaseSalaryForMonth, project } from "./projection";

describe("projection engine", () => {
  it("grows salary in year 2", () => {
    const assumptions = buildAssumptionsFromState({
      ...DEFAULT_FORM_STATE,
      useActualFirstMonthPaycheck: false,
      annualRaisePct: 3,
      maxYears: 2,
    });

    expect(Math.round(getBaseSalaryForMonth(assumptions, 12))).toBe(Math.round(129000 * 1.03));
  });

  it("routes actual first-month loan payment when override is enabled", () => {
    const assumptions = buildAssumptionsFromState({
      ...DEFAULT_FORM_STATE,
      maxYears: 1,
      useActualFirstMonthContributionAllocation: true,
      firstMonthActualStudentLoanPayment: 1234,
      firstMonthActualTaxableFundContribution: 0,
    });
    const result = project(assumptions);

    expect(result.monthlyRows[0]?.studentLoanPayment).toBe(1234);
    expect(result.monthlyRows[0]?.studentLoan).toBeLessThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("models exactly one year as 12 months and keeps the final point", () => {
    const assumptions = buildAssumptionsFromState({
      ...DEFAULT_FORM_STATE,
      maxYears: 1,
      useActualFirstMonthPaycheck: false,
    });
    const result = project(assumptions);

    expect(result.monthlyRows[result.monthlyRows.length - 1]?.month).toBe(11);
    expect(result.rows.some((row) => row.month === 11)).toBe(true);
  });
});
