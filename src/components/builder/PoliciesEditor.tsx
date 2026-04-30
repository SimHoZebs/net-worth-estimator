import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  addOverrideStep,
  addPolicy,
  addPolicyOverride,
  addPolicyStep,
  DEFAULT_SCENARIO_DEFINITION,
  type ScenarioDefinition,
} from "../../lib/projection";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckboxField, NumberField, PercentField, SelectField } from "./shared";

export function PoliciesEditor() {
  const { control, setValue } = useFormContext<ScenarioDefinition>();
  const scenario = (useWatch({ control }) ?? DEFAULT_SCENARIO_DEFINITION) as ScenarioDefinition;
  const policies = (useWatch({ control, name: "allocationPolicies" }) ?? DEFAULT_SCENARIO_DEFINITION.allocationPolicies) as ScenarioDefinition["allocationPolicies"];
  const { fields, append, remove } = useFieldArray({ control, name: "allocationPolicies" });
  const accountOptions = scenario.accounts.map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));
  const destinationAccountOptions = scenario.accounts.filter((account) => account.kind !== "cash").map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));

  const updatePolicies = (updater: (currentPolicies: ScenarioDefinition["allocationPolicies"]) => ScenarioDefinition["allocationPolicies"]) => {
    setValue("allocationPolicies", updater(scenario.allocationPolicies), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Allocation policies</h2>
          <p className="text-sm text-slate-500">Policies tell the runtime how to allocate available source-account cash after base operations have executed.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const nextPolicies = addPolicy(scenario).allocationPolicies;
            const nextPolicy = nextPolicies[nextPolicies.length - 1];
            if (nextPolicy) {
              append(nextPolicy);
            }
          }}
        >
          Add policy
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 pb-4">
          {fields.map((field, policyIndex) => {
            const policy = policies[policyIndex];
            if (!policy) return null;

            return (
              <Card key={field.id} className="min-w-[380px] max-w-[540px] shrink-0 rounded-[1.75rem] border-slate-200 bg-white">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-slate-900">Policy {policyIndex + 1}</h3>
                      <p className="text-xs text-slate-500">ID: <code>{policy.id}</code></p>
                    </div>
                    <Button type="button" variant="destructive" onClick={() => remove(policyIndex)}>
                      Remove
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <SelectField name={`allocationPolicies.${policyIndex}.sourceAccountId` as const} label="Source account">
                      {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </SelectField>
                    <PercentField name={`allocationPolicies.${policyIndex}.rateOfAvailable` as const} label="Rate of available %" min={0} max={100} transform={(value) => Math.max(0, Math.min(1, value))} />
                    <div className="md:col-span-2">
                      <CheckboxField
                        name={`allocationPolicies.${policyIndex}.sweepRemainderFromSource` as const}
                        label="Sweep leftover source cash"
                        helper="Sweep any leftover source-account cash out of the runtime after the allocation steps run. This keeps residual cash from carrying forward."
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h4 className="font-medium text-slate-900">Policy steps</h4>
                        <p className="text-sm text-slate-500">Steps execute in order against the available source balance.</p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => (
                          index === policyIndex ? addPolicyStep(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) : currentPolicy
                        )))}
                      >
                        Add step
                      </Button>
                    </div>

                    {policy.steps.map((_, stepIndex) => (
                      <div key={`${policy.id}-step-${stepIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                        <SelectField name={`allocationPolicies.${policyIndex}.steps.${stepIndex}.destinationAccountId` as const} label="Destination account">
                          {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </SelectField>
                        <SelectField name={`allocationPolicies.${policyIndex}.steps.${stepIndex}.destinationDeltaSign` as const} label="Direction">
                          <option value="1">Increase destination</option>
                          <option value="-1">Reduce destination</option>
                        </SelectField>
                        <SelectField name={`allocationPolicies.${policyIndex}.steps.${stepIndex}.mode` as const} label="Mode">
                          <option value="allRemaining">All remaining</option>
                          <option value="reduceToZero">Reduce destination to zero</option>
                        </SelectField>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => (
                              index === policyIndex
                                ? { ...currentPolicy, steps: currentPolicy.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex) }
                                : currentPolicy
                            )))}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h4 className="font-medium text-slate-900">Fixed month overrides</h4>
                        <p className="text-sm text-slate-500">Overrides replace the normal policy calculation for a specific month.</p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => (
                          index === policyIndex ? addPolicyOverride(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) : currentPolicy
                        )))}
                      >
                        Add override
                      </Button>
                    </div>

                    {policy.overrides.map((_, overrideIndex) => (
                      <div key={`${policy.id}-override-${overrideIndex}`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <NumberField
                              name={`allocationPolicies.${policyIndex}.overrides.${overrideIndex}.month` as const}
                              label="Override month"
                              helper="Month 0 is the first projected month."
                              min={0}
                              step={1}
                              transform={(value) => Math.max(0, Math.round(value))}
                            />
                          </div>
                          <div className="flex items-end pt-7">
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => (
                                index === policyIndex
                                  ? { ...currentPolicy, overrides: currentPolicy.overrides.filter((_, indexToKeep) => indexToKeep !== overrideIndex) }
                                  : currentPolicy
                              )))}
                            >
                              Remove override
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {policy.overrides[overrideIndex]?.steps.map((_, stepIndex) => (
                            <div key={`${policy.id}-override-${overrideIndex}-step-${stepIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                              <SelectField name={`allocationPolicies.${policyIndex}.overrides.${overrideIndex}.steps.${stepIndex}.destinationAccountId` as const} label="Destination account">
                                {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </SelectField>
                              <SelectField name={`allocationPolicies.${policyIndex}.overrides.${overrideIndex}.steps.${stepIndex}.destinationDeltaSign` as const} label="Direction">
                                <option value="1">Increase destination</option>
                                <option value="-1">Reduce destination</option>
                              </SelectField>
                              <NumberField name={`allocationPolicies.${policyIndex}.overrides.${overrideIndex}.steps.${stepIndex}.amount` as const} label="Amount" min={0} transform={(value) => Math.max(0, value)} />
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => {
                                    if (index !== policyIndex) return currentPolicy;

                                    return {
                                      ...currentPolicy,
                                      overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                                        currentOverrideIndex === overrideIndex
                                          ? { ...currentOverride, steps: currentOverride.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex) }
                                          : currentOverride
                                      )),
                                    };
                                  }))}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => updatePolicies((currentPolicies) => currentPolicies.map((currentPolicy, index) => {
                            if (index !== policyIndex) return currentPolicy;

                            return {
                              ...currentPolicy,
                              overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                                currentOverrideIndex === overrideIndex
                                  ? { ...currentOverride, steps: addOverrideStep(currentOverride.steps, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) }
                                  : currentOverride
                              )),
                            };
                          }))}
                        >
                          Add override step
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
