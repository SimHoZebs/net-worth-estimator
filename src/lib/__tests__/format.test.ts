import { describe, expect, it } from "vitest";
import { formatChartCurrencyTick, formatDate, formatElapsedTime, formatFrequency } from "../format";

describe("formatChartCurrencyTick", () => {
  it("formats zero as $0", () => {
    expect(formatChartCurrencyTick(0)).toBe("$0");
  });

  it("formats thousands with k suffix", () => {
    expect(formatChartCurrencyTick(1_000)).toBe("$1k");
    expect(formatChartCurrencyTick(2_500)).toBe("$2.5k");
    expect(formatChartCurrencyTick(999_999)).toBe("$1000k");
  });

  it("formats millions with M suffix", () => {
    expect(formatChartCurrencyTick(1_000_000)).toBe("$1M");
    expect(formatChartCurrencyTick(2_680_000)).toBe("$2.7M");
    expect(formatChartCurrencyTick(6_000_000)).toBe("$6M");
  });

  it("handles negative values", () => {
    expect(formatChartCurrencyTick(-1_000)).toBe("-$1k");
    expect(formatChartCurrencyTick(-2_000_000)).toBe("-$2M");
  });

  it("formats small values without suffix", () => {
    expect(formatChartCurrencyTick(500)).toBe("$500");
    expect(formatChartCurrencyTick(50)).toBe("$50");
  });
});

describe("formatDate", () => {
  it("converts ISO dates to human-readable format", () => {
    expect(formatDate("2026-05-01")).toBe("May 1, 2026");
    expect(formatDate("2042-11-30")).toBe("Nov 30, 2042");
    expect(formatDate("2046-07-30")).toBe("Jul 30, 2046");
  });

  it("returns the input unchanged for invalid or short strings", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("2026")).toBe("2026");
    expect(formatDate("2026-05")).toBe("2026-05");
  });
});

describe("formatElapsedTime", () => {
  it("formats elapsed years and months", () => {
    expect(formatElapsedTime("2026-05-10", "2030-08-10")).toBe("4y 3m");
    expect(formatElapsedTime("2026-05-10", "2027-05-10")).toBe("1y");
    expect(formatElapsedTime("2026-05-10", "2026-08-10")).toBe("3m");
  });

  it("uses days for sub-month durations", () => {
    expect(formatElapsedTime("2026-05-10", "2026-05-20")).toBe("10d");
    expect(formatElapsedTime("2026-05-10", "2026-05-10")).toBe("Now");
  });

  it("rounds down incomplete months", () => {
    expect(formatElapsedTime("2026-05-31", "2026-06-30")).toBe("30d");
    expect(formatElapsedTime("2026-05-31", "2026-07-01")).toBe("1m");
  });
});

describe("formatFrequency", () => {
  it("capitalizes known frequencies", () => {
    expect(formatFrequency("daily")).toBe("Daily");
    expect(formatFrequency("weekly")).toBe("Weekly");
    expect(formatFrequency("monthly")).toBe("Monthly");
    expect(formatFrequency("quarterly")).toBe("Quarterly");
    expect(formatFrequency("annual")).toBe("Annual");
  });

  it("returns unknown frequencies unchanged", () => {
    expect(formatFrequency("biweekly")).toBe("biweekly");
  });
});
