import type { ScenarioDefinition, ScenarioPath, ScenarioValidationIssue } from "../lib/projection";
import { Card, CardContent } from "./ui";
import { AccountsEditor } from "./builder/AccountsEditor";
import { ModulesEditor } from "./builder/ModulesEditor";
import { PoliciesEditor } from "./builder/PoliciesEditor";
import { ScenarioSettingsEditor } from "./builder/ScenarioSettingsEditor";
import { ScenarioValidationPanel } from "./builder/ScenarioValidationPanel";

interface ProjectionControlsProps {
  scenario: ScenarioDefinition;
  validationIssues: ScenarioValidationIssue[];
  updateField: (path: ScenarioPath, value: unknown) => void;
  updateScenario: (updater: (current: ScenarioDefinition) => ScenarioDefinition) => void;
}

export function ProjectionControls({ scenario, validationIssues, updateField, updateScenario }: ProjectionControlsProps) {
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-1">
      <CardContent className="space-y-6 p-6">
        <ScenarioValidationPanel issues={validationIssues} />
        <ScenarioSettingsEditor scenario={scenario} updateField={updateField} />
        <AccountsEditor scenario={scenario} updateField={updateField} updateScenario={updateScenario} />
        <ModulesEditor scenario={scenario} updateField={updateField} updateScenario={updateScenario} />
        <PoliciesEditor scenario={scenario} updateField={updateField} updateScenario={updateScenario} />
      </CardContent>
    </Card>
  );
}
