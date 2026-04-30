import type { ScenarioDefinition, ScenarioPath } from "../../lib/projection";
import { Field, NumberInput } from "./shared";
import { Input } from "../ui";

export function ScenarioSettingsEditor({
  scenario,
  updateField,
}: {
  scenario: ScenarioDefinition;
  updateField: (path: ScenarioPath, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Scenario</h2>
        <p className="text-sm text-slate-500">Edit the canonical scenario document directly. Modules compile into generic runtime instructions.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Scenario name">
          <Input value={scenario.name} onChange={(event) => updateField(["name"], event.currentTarget.value)} />
        </Field>
        <Field label="Target net worth">
          <NumberInput value={scenario.targetNetWorth} onChange={(value) => updateField(["targetNetWorth"], value)} min={0} />
        </Field>
        <Field label="Projection months" helper="12 months = 1 year.">
          <NumberInput value={scenario.horizonMonths} onChange={(value) => updateField(["horizonMonths"], Math.max(1, Math.round(value)))} min={1} step={1} />
        </Field>
      </div>
    </div>
  );
}
