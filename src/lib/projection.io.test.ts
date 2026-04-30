import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION, parseScenarioData, parseScenarioDocument, serializeScenarioDocument } from "./projection";

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

  it("fills missing version and start date when parsing raw scenario data", () => {
    const parsed = parseScenarioData({
      ...DEFAULT_SCENARIO_DEFINITION,
      version: undefined,
      startDate: undefined,
    });

    expect(parsed.version).toBe(2);
    expect(parsed.startDate).toMatch(/^\d{4}-\d{2}$/u);
  });

  it("rejects malformed scenario documents instead of silently falling back", () => {
    expect(() => parseScenarioDocument(JSON.stringify({ nope: true }))).toThrow();
  });
});
