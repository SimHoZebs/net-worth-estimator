import { describe, expect, it } from "vitest";
import { formatChartCurrencyTick, formatDate } from "../format";

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
