import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION, parseScenarioDocument, serializeScenarioDocument } from "./projection";

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
});

