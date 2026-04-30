import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  addModuleByType,
  BUILT_IN_MODULE_ORDER,
  DEFAULT_SCENARIO_DEFINITION,
  getBuiltInModuleTitle,
  isSingletonBuiltInModuleType,
  type ScenarioDefinition,
  type ScenarioModule,
} from "../../lib/projection";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { CheckboxField, Field, NullableMonthField, NumberField, PercentField, SelectField, TextField } from "./shared";

function scenarioHasModuleType(scenario: ScenarioDefinition, type: ScenarioModule["type"]): boolean {
  return scenario.modules.some((module) => module.type === type);
}

export function ModulesEditor() {
  const { control, setValue } = useFormContext<ScenarioDefinition>();
  const scenario = (useWatch({ control }) ?? DEFAULT_SCENARIO_DEFINITION) as ScenarioDefinition;
  const modules = (useWatch({ control, name: "modules" }) ?? DEFAULT_SCENARIO_DEFINITION.modules) as ScenarioDefinition["modules"];
  const { fields, append, remove } = useFieldArray({ control, name: "modules" });
  const accountOptions = scenario.accounts.map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));
  const destinationAccountOptions = scenario.accounts.filter((account) => account.kind !== "cash").map((account) => ({
    value: account.id,
    label: `${account.label} (${account.kind})`,
  }));

  const updateModules = (updater: (currentModules: ScenarioDefinition["modules"]) => ScenarioDefinition["modules"]) => {
    setValue("modules", updater(scenario.modules), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Built-in modules</h2>
          <p className="text-sm text-slate-500">Modules compile human concepts into generic operations, rate rules, and tax/liquidity behavior.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {BUILT_IN_MODULE_ORDER.map((type) => {
            const isDisabled = isSingletonBuiltInModuleType(type) && scenarioHasModuleType(scenario, type);

            return (
              <Button
                key={type}
                type="button"
                variant="secondary"
                disabled={isDisabled}
                onClick={() => {
                  const nextModules = addModuleByType(scenario, type).modules;
                  const nextModule = nextModules[nextModules.length - 1];
                  if (nextModule) {
                    append(nextModule);
                  }
                }}
              >
                Add {getBuiltInModuleTitle(type)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 pb-4">
          {fields.map((field, moduleIndex) => {
            const module = modules[moduleIndex];
            if (!module) return null;

            return (
              <Card key={field.id} className="min-w-[360px] max-w-[480px] shrink-0 rounded-[1.75rem] border-slate-200 bg-white">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-slate-900">{getBuiltInModuleTitle(module.type)}</h3>
                      <p className="text-xs text-slate-500">ID: <code>{module.id}</code></p>
                    </div>
                    <Button type="button" variant="destructive" onClick={() => remove(moduleIndex)}>
                      Remove
                    </Button>
                  </div>

                  {module.type === "employmentIncome" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <NumberField name={`modules.${moduleIndex}.annualBaseSalary` as const} label="Annual base salary" min={0} transform={(value) => Math.max(0, value)} />
                      <PercentField name={`modules.${moduleIndex}.annualRaiseRate` as const} label="Annual raise %" min={0} transform={(value) => Math.max(0, value)} />
                      <div className="md:col-span-2">
                        <CheckboxField
                          name={`modules.${moduleIndex}.firstMonthActualPaycheck.enabled` as const}
                          label="Actual month 0 paycheck"
                          helper="Use an actual first-month paycheck instead of the modeled monthly salary for month 0."
                        />
                      </div>
                      <NumberField name={`modules.${moduleIndex}.firstMonthActualPaycheck.regularGross` as const} label="First-month regular gross" min={0} transform={(value) => Math.max(0, value)} />
                      <NumberField name={`modules.${moduleIndex}.firstMonthActualPaycheck.signingBonus` as const} label="First-month signing bonus" min={0} transform={(value) => Math.max(0, value)} />
                      <NumberField name={`modules.${moduleIndex}.firstMonthActualPaycheck.takeHome` as const} label="First-month take-home cash" min={0} transform={(value) => Math.max(0, value)} />
                    </div>
                  ) : null}

                  {module.type === "recurringFlow" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TextField name={`modules.${moduleIndex}.label` as const} label="Label" />
                      <NumberField name={`modules.${moduleIndex}.amount` as const} label="Monthly amount" min={0} transform={(value) => Math.max(0, value)} />
                      <Controller
                        control={control}
                        name={`modules.${moduleIndex}.eventType` as const}
                        render={({ fieldState }) => (
                          <Field label="Flow kind" error={fieldState.error?.message}>
                            <NativeSelect
                              value={module.eventType === "expense" ? "expense" : "after-tax-income"}
                              onChange={(event) => {
                                const nextValue = event.currentTarget.value;
                                updateModules((currentModules) => currentModules.map((currentModule, index) => {
                                  if (index !== moduleIndex || currentModule.type !== "recurringFlow") return currentModule;
                                  return nextValue === "expense"
                                    ? { ...currentModule, eventType: "expense", taxTreatment: "after-tax" }
                                    : { ...currentModule, eventType: "ordinary_income", taxTreatment: "after-tax" };
                                }));
                              }}
                            >
                              <option value="expense">Expense</option>
                              <option value="after-tax-income">After-tax income</option>
                            </NativeSelect>
                          </Field>
                        )}
                      />
                      <NumberField name={`modules.${moduleIndex}.startMonth` as const} label="Start month" helper="Month 0 is the first projected month." min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                      <NullableMonthField name={`modules.${moduleIndex}.endMonth` as const} label="End month" helper="Leave blank to keep running through the full horizon." />
                      <div className="md:col-span-2">
                        <CheckboxField
                          name={`modules.${moduleIndex}.skipWhenActualFirstMonthPaycheck` as const}
                          label="Skip when actual paycheck is enabled"
                          helper="Skip this flow in month 0 when the employment module uses an actual paycheck override. Useful for benefits already reflected in take-home cash."
                        />
                      </div>
                    </div>
                  ) : null}

                  {module.type === "oneTimeFlow" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TextField name={`modules.${moduleIndex}.label` as const} label="Label" />
                      <NumberField name={`modules.${moduleIndex}.amount` as const} label="Amount" min={0} transform={(value) => Math.max(0, value)} />
                      <NumberField name={`modules.${moduleIndex}.month` as const} label="Month" min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                      <SelectField name={`modules.${moduleIndex}.eventType` as const} label="Flow kind">
                        <option value="expense">Expense</option>
                        <option value="ordinary_income">After-tax income</option>
                      </SelectField>
                    </div>
                  ) : null}

                  {module.type === "scheduledTransfer" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TextField name={`modules.${moduleIndex}.label` as const} label="Label" />
                      <NumberField name={`modules.${moduleIndex}.amount` as const} label="Amount" min={0} transform={(value) => Math.max(0, value)} />
                      <SelectField name={`modules.${moduleIndex}.sourceAccountId` as const} label="Source account">
                        {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </SelectField>
                      <SelectField name={`modules.${moduleIndex}.destinationAccountId` as const} label="Destination account">
                        {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </SelectField>
                      <NumberField name={`modules.${moduleIndex}.startMonth` as const} label="Start month" min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                      <NullableMonthField name={`modules.${moduleIndex}.endMonth` as const} label="End month" />
                      <NumberField name={`modules.${moduleIndex}.frequencyMonths` as const} label="Frequency months" min={1} step={1} transform={(value) => Math.max(1, Math.round(value))} />
                      <Controller
                        control={control}
                        name={`modules.${moduleIndex}.destinationDeltaSign` as const}
                        render={({ fieldState }) => (
                          <Field label="Direction" error={fieldState.error?.message}>
                            <NativeSelect
                              value={String(module.destinationDeltaSign)}
                              onChange={(event) => setValue(`modules.${moduleIndex}.destinationDeltaSign`, Number(event.currentTarget.value) as 1 | -1, { shouldDirty: true, shouldValidate: true })}
                            >
                              <option value="1">Increase destination</option>
                              <option value="-1">Reduce destination</option>
                            </NativeSelect>
                          </Field>
                        )}
                      />
                      <SelectField name={`modules.${moduleIndex}.eventType` as const} label="Event type">
                        <option value="transfer">Transfer</option>
                        <option value="debt_payment">Debt payment</option>
                      </SelectField>
                    </div>
                  ) : null}

                  {module.type === "retirementPlan" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <SelectField name={`modules.${moduleIndex}.destinationAccountId` as const} label="Destination account">
                        {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </SelectField>
                      <NumberField name={`modules.${moduleIndex}.annualEmployeeLimit` as const} label="Annual employee limit" min={0} transform={(value) => Math.max(0, value)} />
                      <PercentField name={`modules.${moduleIndex}.employeeContributionRate` as const} label="Employee contribution %" min={0} transform={(value) => Math.max(0, value)} />
                      <PercentField name={`modules.${moduleIndex}.employerMatchRate` as const} label="Employer match %" min={0} transform={(value) => Math.max(0, value)} />
                      <PercentField name={`modules.${moduleIndex}.employerMatchLimitRate` as const} label="Employer match limit %" min={0} transform={(value) => Math.max(0, value)} />
                      <div className="md:col-span-2">
                        <CheckboxField
                          name={`modules.${moduleIndex}.firstMonthOverride.enabled` as const}
                          label="Actual month 0 retirement contributions"
                          helper="Use actual first-month retirement contributions instead of the modeled contribution and match."
                        />
                      </div>
                      <NumberField name={`modules.${moduleIndex}.firstMonthOverride.employeeContribution` as const} label="First-month employee contribution" min={0} transform={(value) => Math.max(0, value)} />
                      <NumberField name={`modules.${moduleIndex}.firstMonthOverride.employerContribution` as const} label="First-month employer contribution" min={0} transform={(value) => Math.max(0, value)} />
                    </div>
                  ) : null}

                  {module.type === "equityGrantSeries" ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <SelectField name={`modules.${moduleIndex}.destinationAccountId` as const} label="Destination account">
                          {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </SelectField>
                        <NumberField name={`modules.${moduleIndex}.employeeMonthsAtProjectionStart` as const} label="Employee months at start" min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                        <NumberField name={`modules.${moduleIndex}.initialGrantValue` as const} label="Initial grant value" min={0} transform={(value) => Math.max(0, value)} />
                        <NumberField name={`modules.${moduleIndex}.refreshGrantValue` as const} label="Refresh grant value" min={0} transform={(value) => Math.max(0, value)} />
                        <NumberField name={`modules.${moduleIndex}.firstRefreshGrantMonth` as const} label="First refresh grant month" min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                        <NumberField name={`modules.${moduleIndex}.refreshFrequencyMonths` as const} label="Refresh frequency months" min={1} step={1} transform={(value) => Math.max(1, Math.round(value))} />
                        <NumberField name={`modules.${moduleIndex}.annualBaseSalary` as const} label="Salary-linked annual base salary" min={0} transform={(value) => Math.max(0, value)} />
                        <PercentField name={`modules.${moduleIndex}.annualRaiseRate` as const} label="Salary-linked annual raise %" min={0} transform={(value) => Math.max(0, value)} />
                        <PercentField name={`modules.${moduleIndex}.salaryLinkedRefreshPctOfBase` as const} label="Salary-linked refresh % of base" min={0} transform={(value) => Math.max(0, value)} />
                        <div className="md:col-span-2">
                          <CheckboxField
                            name={`modules.${moduleIndex}.useSalaryGrowthForRefreshers` as const}
                            label="Use salary growth for refreshers"
                            helper="Scale refresher grants using the linked salary and salary-linked percentage instead of a fixed refresh grant amount."
                          />
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-slate-900">Vesting schedule</h4>
                            <p className="text-sm text-slate-500">Each row is a month offset and percentage of the grant value.</p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => updateModules((currentModules) => currentModules.map((currentModule, index) => {
                              if (index !== moduleIndex || currentModule.type !== "equityGrantSeries") return currentModule;
                              return {
                                ...currentModule,
                                vestingSchedule: [...currentModule.vestingSchedule, { monthOffset: 0, pct: 0 }],
                              };
                            }))}
                          >
                            Add vest row
                          </Button>
                        </div>

                        <div className="space-y-3">
                          {module.vestingSchedule.map((_, vestingIndex) => (
                            <div key={`${module.id}-vesting-${vestingIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                              <NumberField name={`modules.${moduleIndex}.vestingSchedule.${vestingIndex}.monthOffset` as const} label="Month offset" min={0} step={1} transform={(value) => Math.max(0, Math.round(value))} />
                              <PercentField name={`modules.${moduleIndex}.vestingSchedule.${vestingIndex}.pct` as const} label="Percent of grant" min={0} transform={(value) => Math.max(0, value)} />
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => updateModules((currentModules) => currentModules.map((currentModule, index) => {
                                    if (index !== moduleIndex || currentModule.type !== "equityGrantSeries") return currentModule;
                                    return {
                                      ...currentModule,
                                      vestingSchedule: currentModule.vestingSchedule.filter((_, indexToKeep) => indexToKeep !== vestingIndex),
                                    };
                                  }))}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {module.type === "tax" ? (
                    <p className="text-sm text-slate-500">Uses the built-in US federal 2026 tax model and allocates liability across supported income sources before the generic runtime executes cash movements.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
