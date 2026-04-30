import { NumberField, TextField } from "./shared";

export function ScenarioSettingsEditor() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Scenario</h2>
        <p className="text-sm text-slate-500">Edit the canonical scenario document directly. Modules compile into generic runtime instructions.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField name="name" label="Scenario name" />
        <TextField name="startDate" label="Projection start month" helper="Format: YYYY-MM." />
        <NumberField name="targetNetWorth" label="Target net worth" min={0} transform={(value) => Math.max(0, value)} />
        <NumberField name="horizonMonths" label="Projection months" helper="12 months = 1 year." min={1} step={1} transform={(value) => Math.max(1, Math.round(value))} />
      </div>
    </div>
  );
}
