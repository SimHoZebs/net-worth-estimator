import { memo } from "react";
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
import { CheckboxField, NumberField, PercentField, SelectField, type SelectOption } from "./shared";

const PolicyCard = memo(function PolicyCard({
  policyIndex,
  accountOptions,
  destinationAccountOptions,
  removePolicy,
  updatePolicy,
}: {
  policyIndex: number;
  accountOptions: SelectOption[];
  destinationAccountOptions: SelectOption[];
  removePolicy: (index: number) => void;
  updatePolicy: (policyIndex: number, updater: (currentPolicy: ScenarioDefinition["allocationPolicies"][number]) => ScenarioDefinition["allocationPolicies"][number]) => void;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const policy = useWatch({
    control,
    name: `allocationPolicies.${policyIndex}` as const,
  }) as ScenarioDefinition["allocationPolicies"][number] | undefined;

  if (!policy) return null;

  return (
    <Card className="min-w-[380px] max-w-[540px] shrink-0 rounded-[1.75rem] border-slate-200 bg-white">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">Policy {policyIndex + 1}</h3>
            <p className="text-xs text-slate-500">ID: <code>{policy.id}</code></p>
          </div>
          <Button type="button" variant="destructive" onClick={() => removePolicy(policyIndex)}>
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
              onClick={() => updatePolicy(policyIndex, (currentPolicy) => addPolicyStep(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId))}
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
                  onClick={() => updatePolicy(policyIndex, (currentPolicy) => ({
                    ...currentPolicy,
                    steps: currentPolicy.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex),
                  }))}
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
              onClick={() => updatePolicy(policyIndex, (currentPolicy) => addPolicyOverride(currentPolicy, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId))}
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
                    onClick={() => updatePolicy(policyIndex, (currentPolicy) => ({
                      ...currentPolicy,
                      overrides: currentPolicy.overrides.filter((_, indexToKeep) => indexToKeep !== overrideIndex),
                    }))}
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
                        onClick={() => updatePolicy(policyIndex, (currentPolicy) => ({
                          ...currentPolicy,
                          overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                            currentOverrideIndex === overrideIndex
                              ? { ...currentOverride, steps: currentOverride.steps.filter((_, indexToKeep) => indexToKeep !== stepIndex) }
                              : currentOverride
                          )),
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
                onClick={() => updatePolicy(policyIndex, (currentPolicy) => ({
                  ...currentPolicy,
                  overrides: currentPolicy.overrides.map((currentOverride, currentOverrideIndex) => (
                    currentOverrideIndex === overrideIndex
                      ? { ...currentOverride, steps: addOverrideStep(currentOverride.steps, destinationAccountOptions[0]?.value ?? currentPolicy.sourceAccountId) }
                      : currentOverride
                  )),
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
});

export function PoliciesEditor() {
  const { control, setValue, getValues } = useFormContext<ScenarioDefinition>();
  const accounts = (useWatch({ control, name: "accounts" }) ?? DEFAULT_SCENARIO_DEFINITION.accounts) as ScenarioDefinition["accounts"];
  const { fields, append, remove } = useFieldArray({ control, name: "allocationPolicies" });
  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));
  const destinationAccountOptions = accounts.filter((account) => account.kind !== "cash").map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));

  const updatePolicy = (
    policyIndex: number,
    updater: (currentPolicy: ScenarioDefinition["allocationPolicies"][number]) => ScenarioDefinition["allocationPolicies"][number]
  ) => {
    const currentPolicy = getValues(`allocationPolicies.${policyIndex}` as const);
    if (!currentPolicy) return;

    setValue(`allocationPolicies.${policyIndex}` as const, updater(currentPolicy), {
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
            const nextPolicies = addPolicy(getValues()).allocationPolicies;
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
          {fields.map((field, policyIndex) => (
            <PolicyCard
              key={field.id}
              policyIndex={policyIndex}
              accountOptions={accountOptions}
              destinationAccountOptions={destinationAccountOptions}
              removePolicy={remove}
              updatePolicy={updatePolicy}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
