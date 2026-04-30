import {
  addOverrideStep,
  addPolicy,
  addPolicyOverride,
  addPolicyStep,
  removePolicyAt,
  type AllocationOverrideStep,
  type AllocationPolicyStep,
  type ScenarioDefinition,
  type ScenarioPath,
} from "../../lib/projection";
import { CheckboxInput, Field, NumberInput, sectionButtonClassName, SelectInput } from "./shared";

export function PoliciesEditor({
  scenario,
  updateField,
  updateScenario,
}: {
  scenario: ScenarioDefinition;
  updateField: (path: ScenarioPath, value: unknown) => void;
  updateScenario: (updater: (current: ScenarioDefinition) => ScenarioDefinition) => void;
}) {
  const accountOptions = scenario.accounts.map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));
  const destinationAccountOptions = scenario.accounts.filter((account) => account.kind !== "cash").map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Allocation policies</h2>
          <p className="text-sm text-slate-500">Policies tell the runtime how to allocate available source-account cash after base operations have executed.</p>
        </div>
        <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addPolicy(current))}>Add policy</button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide">
        {scenario.allocationPolicies.map((policy, policyIndex) => (
          <div key={policy.id} className="min-w-[360px] max-w-[500px] shrink-0 snap-start space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900">Policy {policyIndex + 1}</h3>
                <p className="text-xs text-slate-500">ID: <code>{policy.id}</code></p>
              </div>
              <button type="button" className={sectionButtonClassName("danger")} onClick={() => updateScenario((current) => removePolicyAt(current, policyIndex))}>
                Remove
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Source account">
                <SelectInput value={policy.sourceAccountId} onChange={(value) => updateField(["allocationPolicies", policyIndex, "sourceAccountId"], value)}>
                  {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectInput>
              </Field>
              <Field label="Rate of available %">
                <NumberInput value={policy.rateOfAvailable * 100} onChange={(value) => updateField(["allocationPolicies", policyIndex, "rateOfAvailable"], Math.max(0, Math.min(100, value)) / 100)} min={0} />
              </Field>
              <div className="md:col-span-2">
                <CheckboxInput
                  checked={policy.sweepRemainderFromSource}
                  onChange={(checked) => updateField(["allocationPolicies", policyIndex, "sweepRemainderFromSource"], checked)}
                  label="Sweep any leftover source-account cash out of the runtime after the allocation steps run. This keeps residual cash from carrying forward."
                />
              </div>
            </div>

            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium text-slate-900">Policy steps</h4>
                  <p className="text-sm text-slate-500">Steps execute in order against the available source balance.</p>
                </div>
                <button
                  type="button"
                  className={sectionButtonClassName()}
                  onClick={() => updateScenario((current) => ({
                    ...current,
                    allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => (
                      index === policyIndex ? addPolicyStep(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) : currentPolicy
                    )),
                  }))}
                >
                  Add step
                </button>
              </div>

              {policy.steps.map((step, stepIndex) => (
                <div key={`${policy.id}-step-${stepIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                  <Field label="Destination account">
                    <SelectInput value={step.destinationAccountId} onChange={(value) => updateField(["allocationPolicies", policyIndex, "steps", stepIndex, "destinationAccountId"], value)}>
                      {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </SelectInput>
                  </Field>
                  <Field label="Direction">
                    <SelectInput value={String(step.destinationDeltaSign)} onChange={(value) => updateField(["allocationPolicies", policyIndex, "steps", stepIndex, "destinationDeltaSign"], Number(value) as AllocationPolicyStep["destinationDeltaSign"])}>
                      <option value="1">Increase destination</option>
                      <option value="-1">Reduce destination</option>
                    </SelectInput>
                  </Field>
                  <Field label="Mode">
                    <SelectInput value={step.mode} onChange={(value) => updateField(["allocationPolicies", policyIndex, "steps", stepIndex, "mode"], value)}>
                      <option value="allRemaining">All remaining</option>
                      <option value="reduceToZero">Reduce destination to zero</option>
                    </SelectInput>
                  </Field>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className={sectionButtonClassName("danger")}
                      onClick={() => updateScenario((current) => ({
                        ...current,
                        allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => (
                          index === policyIndex
                            ? { ...currentPolicy, steps: currentPolicy.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex) }
                            : currentPolicy
                        )),
                      }))}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium text-slate-900">Fixed month overrides</h4>
                  <p className="text-sm text-slate-500">Overrides replace the normal policy calculation for a specific month.</p>
                </div>
                <button
                  type="button"
                  className={sectionButtonClassName()}
                  onClick={() => updateScenario((current) => ({
                    ...current,
                    allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => (
                      index === policyIndex ? addPolicyOverride(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) : currentPolicy
                    )),
                  }))}
                >
                  Add override
                </button>
              </div>

              {policy.overrides.map((override, overrideIndex) => (
                <div key={`${policy.id}-override-${overrideIndex}`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-4">
                    <Field label="Override month" helper="Month 0 is the first projected month.">
                      <NumberInput value={override.month} onChange={(value) => updateField(["allocationPolicies", policyIndex, "overrides", overrideIndex, "month"], Math.max(0, Math.round(value)))} min={0} step={1} />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className={sectionButtonClassName("danger")}
                        onClick={() => updateScenario((current) => ({
                          ...current,
                          allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => (
                            index === policyIndex
                              ? { ...currentPolicy, overrides: currentPolicy.overrides.filter((_, indexToKeep) => indexToKeep !== overrideIndex) }
                              : currentPolicy
                          )),
                        }))}
                      >
                        Remove override
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {override.steps.map((step, stepIndex) => (
                      <div key={`${policy.id}-override-${overrideIndex}-step-${stepIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                        <Field label="Destination account">
                          <SelectInput value={step.destinationAccountId} onChange={(value) => updateField(["allocationPolicies", policyIndex, "overrides", overrideIndex, "steps", stepIndex, "destinationAccountId"], value)}>
                            {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </SelectInput>
                        </Field>
                        <Field label="Direction">
                          <SelectInput value={String(step.destinationDeltaSign)} onChange={(value) => updateField(["allocationPolicies", policyIndex, "overrides", overrideIndex, "steps", stepIndex, "destinationDeltaSign"], Number(value) as AllocationOverrideStep["destinationDeltaSign"])}>
                            <option value="1">Increase destination</option>
                            <option value="-1">Reduce destination</option>
                          </SelectInput>
                        </Field>
                        <Field label="Amount">
                          <NumberInput value={step.amount} onChange={(value) => updateField(["allocationPolicies", policyIndex, "overrides", overrideIndex, "steps", stepIndex, "amount"], Math.max(0, value))} min={0} />
                        </Field>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className={sectionButtonClassName("danger")}
                            onClick={() => updateScenario((current) => ({
                              ...current,
                              allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => {
                                if (index !== policyIndex) return currentPolicy;

                                return {
                                  ...currentPolicy,
                                  overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                                    currentOverrideIndex === overrideIndex
                                      ? { ...currentOverride, steps: currentOverride.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex) }
                                      : currentOverride
                                  )),
                                };
                              }),
                            }))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={sectionButtonClassName()}
                    onClick={() => updateScenario((current) => ({
                      ...current,
                      allocationPolicies: current.allocationPolicies.map((currentPolicy, index) => {
                        if (index !== policyIndex) return currentPolicy;

                        return {
                          ...currentPolicy,
                          overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                            currentOverrideIndex === overrideIndex
                              ? { ...currentOverride, steps: addOverrideStep(currentOverride.steps, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) }
                              : currentOverride
                          )),
                        };
                      }),
                    }))}
                  >
                    Add override step
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
