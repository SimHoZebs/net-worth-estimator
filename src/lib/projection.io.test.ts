import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, DEFAULT_SCENARIO_DEFINITION, parseScenarioData, parseScenarioDocument, serializeScenarioDocument } from "./projection";

describe("scenario document IO", () => {
  it("round-trips a serialized v2 scenario document", () => {
    const scenario = {
      ...DEFAULT_SCENARIO_DEFINITION,
      name: "Custom scenario",
      targetNetWorth: 1_500_000,
    };

    const parsed = parseScenarioDocument(serializeScenarioDocument(scenario));

    expect(parsed.name).toBe("Custom scenario");
    expect(parsed.targetNetWorth).toBe(1_500_000);
  });

  it("migrates a legacy planner document into a scenario definition", () => {
    const parsed = parseScenarioData({ scenario: DEFAULT_SCENARIO });

    expect(parsed.version).toBe(2);
    expect(parsed.accounts.some((account) => account.id === "k401")).toBe(true);
    expect(parsed.modules.some((module) => module.type === "employmentIncome")).toBe(true);
    expect(parsed.allocationPolicies.length).toBeGreaterThan(0);
  });
});
