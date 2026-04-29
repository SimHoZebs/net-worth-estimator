import {
  getScenarioValue,
  type ProjectionScenario,
  type ScenarioPath,
} from "../lib/projection";
import type { ScenarioFieldDefinition } from "../lib/projection/formSchema";
import { NumberField } from "./NumberField";
import { PercentSlider } from "./PercentSlider";

interface ScenarioFieldProps {
  scenario: ProjectionScenario;
  field: ScenarioFieldDefinition;
  updateField: (path: ScenarioPath, value: unknown) => void;
}

export function ScenarioField({ scenario, field, updateField }: ScenarioFieldProps) {
  switch (field.kind) {
    case "number":
      return (
        <NumberField
          className={field.className}
          label={field.label}
          value={getScenarioValue<number>(scenario, field.path)}
          onChange={(value) => updateField(field.path, value)}
          helper={field.helper}
        />
      );

    case "slider":
      return (
        <PercentSlider
          label={field.label}
          value={getScenarioValue<number>(scenario, field.path)}
          onChange={(value) => updateField(field.path, value)}
          min={field.min}
          max={field.max}
          step={field.step}
          suffix={field.suffix}
        />
      );

    case "checkbox":
      return (
        <label className={`flex items-start gap-2 cursor-pointer text-sm text-slate-600 ${field.containerClassName ?? ""}`}>
          <input
            type="checkbox"
            className="mt-1"
            checked={getScenarioValue<boolean>(scenario, field.path)}
            onChange={(event) => updateField(field.path, event.currentTarget.checked)}
          />
          <span>
            <strong className="text-slate-900">{field.label}.</strong> {field.description}
          </span>
        </label>
      );

    default:
      return null;
  }
}
