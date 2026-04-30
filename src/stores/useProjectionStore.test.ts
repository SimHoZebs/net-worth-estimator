import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION, serializeScenarioDocument } from "@/lib/projection";
import { useProjectionStore } from "./useProjectionStore";

describe("useProjectionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectionStore.getState().resetScenario();
  });

  it("syncs local edits without bumping the external revision", () => {
    const initialRevision = useProjectionStore.getState().scenarioRevision;
    useProjectionStore.getState().syncScenario({
      ...DEFAULT_SCENARIO_DEFINITION,
      name: "Edited in form",
    });

    const state = useProjectionStore.getState();
    expect(state.scenario.name).toBe("Edited in form");
    expect(state.scenarioRevision).toBe(initialRevision);
  });

  it("bumps the revision when importing a scenario document", () => {
    const initialRevision = useProjectionStore.getState().scenarioRevision;
    const imported = useProjectionStore.getState().importScenario(
      serializeScenarioDocument({
        ...DEFAULT_SCENARIO_DEFINITION,
        name: "Imported scenario",
      })
    );

    const state = useProjectionStore.getState();
    expect(imported).toBe(true);
    expect(state.scenario.name).toBe("Imported scenario");
    expect(state.scenarioRevision).toBe(initialRevision + 1);
  });
});
