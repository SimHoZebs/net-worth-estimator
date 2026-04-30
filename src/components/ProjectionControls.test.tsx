import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION } from "@/lib/projection";
import type { ScenarioDefinition } from "@/lib/projection";
import { ProjectionControls } from "./ProjectionControls";

vi.mock("./builder/AccountsEditor", () => ({
  AccountsEditor: () => null,
}));

vi.mock("./builder/ModulesEditor", () => ({
  ModulesEditor: () => null,
}));

vi.mock("./builder/PoliciesEditor", () => ({
  PoliciesEditor: () => null,
}));

vi.mock("./builder/ScenarioValidationPanel", () => ({
  ScenarioValidationPanel: () => null,
}));

vi.mock("./builder/ScenarioSettingsEditor", async () => {
  const { useFormContext } = await import("react-hook-form");

  return {
    ScenarioSettingsEditor: () => {
      const form = useFormContext<ScenarioDefinition>();

      return <input aria-label="Scenario name" {...form.register("name")} />;
    },
  };
});

function ProjectionControlsHarness() {
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO_DEFINITION);

  return (
    <ProjectionControls
      scenario={scenario}
      scenarioRevision={0}
      validationIssues={[]}
      onScenarioChange={setScenario}
    />
  );
}

describe("ProjectionControls", () => {
  it("keeps local edits without re-entering the store sync loop", async () => {
    const user = userEvent.setup();

    render(<ProjectionControlsHarness />);

    const input = screen.getByLabelText("Scenario name");
    await user.clear(input);
    await user.type(input, "Edited in form");

    expect((input as HTMLInputElement).value).toBe("Edited in form");
  });
});
