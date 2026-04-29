import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, parseScenarioData, parseScenarioDocument, serializeScenarioDocument } from "./projection";

describe("scenario document IO", () => {
  it("round-trips a serialized versioned scenario document", () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      compensation: {
        ...DEFAULT_SCENARIO.compensation,
        baseSalary: 150000,
      },
      strategy: {
        ...DEFAULT_SCENARIO.strategy,
        extraInvestmentPct: 22,
      },
    };

    const parsed = parseScenarioDocument(serializeScenarioDocument(scenario));

    expect(parsed.compensation.baseSalary).toBe(150000);
    expect(parsed.strategy.extraInvestmentPct).toBe(22);
  });

  it("fills missing or invalid fields from defaults", () => {
    const parsed = parseScenarioData({
      scenario: {
        compensation: { baseSalary: 175000 },
        strategy: { extraInvestmentPct: "not-a-number" },
      },
    });

    expect(parsed.compensation.baseSalary).toBe(175000);
    expect(parsed.compensation.initialRsuGrantValue).toBe(DEFAULT_SCENARIO.compensation.initialRsuGrantValue);
    expect(parsed.strategy.extraInvestmentPct).toBe(DEFAULT_SCENARIO.strategy.extraInvestmentPct);
    expect(parsed.overrides.firstMonth.useActualPaycheck).toBe(DEFAULT_SCENARIO.overrides.firstMonth.useActualPaycheck);
  });
});
