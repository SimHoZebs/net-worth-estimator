import {
  addModuleByType,
  BUILT_IN_MODULE_ORDER,
  getBuiltInModuleTitle,
  isSingletonBuiltInModuleType,
  removeModuleAt,
  type ScenarioDefinition,
  type ScenarioModule,
  type ScenarioPath,
} from "../../lib/projection";
import { CheckboxInput, Field, handleNullableMonthChange, NumberInput, PercentInput, sectionButtonClassName, SelectInput } from "./shared";
import { Input } from "../ui";

function scenarioHasModuleType(scenario: ScenarioDefinition, type: ScenarioModule["type"]): boolean {
  return scenario.modules.some((module) => module.type === type);
}

export function ModulesEditor({
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
          <h2 className="text-lg font-bold">Built-in modules</h2>
          <p className="text-sm text-slate-500">Modules compile human concepts into generic operations, rate rules, and tax/liquidity behavior.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {BUILT_IN_MODULE_ORDER.map((type) => {
            const isDisabled = isSingletonBuiltInModuleType(type) && scenarioHasModuleType(scenario, type);

            return (
              <button
                key={type}
                type="button"
                className={sectionButtonClassName()}
                disabled={isDisabled}
                onClick={() => updateScenario((current) => addModuleByType(current, type))}
              >
                Add {getBuiltInModuleTitle(type)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide">
        {scenario.modules.map((module, moduleIndex) => (
          <div key={module.id} className="min-w-[340px] max-w-[450px] shrink-0 snap-start space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900">{getBuiltInModuleTitle(module.type)}</h3>
                <p className="text-xs text-slate-500">ID: <code>{module.id}</code></p>
              </div>
              <button type="button" className={sectionButtonClassName("danger")} onClick={() => updateScenario((current) => removeModuleAt(current, moduleIndex))}>
                Remove
              </button>
            </div>

            {module.type === "employmentIncome" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Annual base salary">
                  <NumberInput value={module.annualBaseSalary} onChange={(value) => updateField(["modules", moduleIndex, "annualBaseSalary"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Annual raise %">
                  <PercentInput value={module.annualRaiseRate} onChange={(value) => updateField(["modules", moduleIndex, "annualRaiseRate"], Math.max(0, value))} min={0} />
                </Field>
                <div className="md:col-span-2">
                  <CheckboxInput
                    checked={module.firstMonthActualPaycheck.enabled}
                    onChange={(checked) => updateField(["modules", moduleIndex, "firstMonthActualPaycheck", "enabled"], checked)}
                    label="Use an actual first-month paycheck instead of the modeled monthly salary for month 0."
                  />
                </div>
                <Field label="First-month regular gross">
                  <NumberInput value={module.firstMonthActualPaycheck.regularGross} onChange={(value) => updateField(["modules", moduleIndex, "firstMonthActualPaycheck", "regularGross"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="First-month signing bonus">
                  <NumberInput value={module.firstMonthActualPaycheck.signingBonus} onChange={(value) => updateField(["modules", moduleIndex, "firstMonthActualPaycheck", "signingBonus"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="First-month take-home cash">
                  <NumberInput value={module.firstMonthActualPaycheck.takeHome} onChange={(value) => updateField(["modules", moduleIndex, "firstMonthActualPaycheck", "takeHome"], Math.max(0, value))} min={0} />
                </Field>
              </div>
            ) : null}

            {module.type === "recurringFlow" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Label">
                  <Input value={module.label} onChange={(event) => updateField(["modules", moduleIndex, "label"], event.currentTarget.value)} />
                </Field>
                <Field label="Monthly amount">
                  <NumberInput value={module.amount} onChange={(value) => updateField(["modules", moduleIndex, "amount"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Flow kind">
                  <SelectInput
                    value={module.eventType === "expense" ? "expense" : "after-tax-income"}
                    onChange={(value) => updateScenario((current) => ({
                      ...current,
                      modules: current.modules.map((currentModule, index) => {
                        if (index !== moduleIndex || currentModule.type !== "recurringFlow") return currentModule;
                        return value === "expense"
                          ? { ...currentModule, eventType: "expense", taxTreatment: "after-tax" }
                          : { ...currentModule, eventType: "ordinary_income", taxTreatment: "after-tax" };
                      }),
                    }))}
                  >
                    <option value="expense">Expense</option>
                    <option value="after-tax-income">After-tax income</option>
                  </SelectInput>
                </Field>
                <Field label="Start month" helper="Month 0 is the first projected month.">
                  <NumberInput value={module.startMonth} onChange={(value) => updateField(["modules", moduleIndex, "startMonth"], Math.max(0, Math.round(value)))} min={0} step={1} />
                </Field>
                <Field label="End month" helper="Leave blank to keep running through the full horizon.">
                  <Input
                    type="number"
                    value={module.endMonth ?? ""}
                    min={0}
                    step={1}
                    onChange={(event) => handleNullableMonthChange(event, (value) => updateField(["modules", moduleIndex, "endMonth"], value))}
                  />
                </Field>
                <div className="md:col-span-2">
                  <CheckboxInput
                    checked={Boolean(module.skipWhenActualFirstMonthPaycheck)}
                    onChange={(checked) => updateField(["modules", moduleIndex, "skipWhenActualFirstMonthPaycheck"], checked)}
                    label="Skip this flow in month 0 when the employment module uses an actual paycheck override. Useful for benefits already reflected in take-home cash."
                  />
                </div>
              </div>
            ) : null}

            {module.type === "oneTimeFlow" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Label">
                  <Input value={module.label} onChange={(event) => updateField(["modules", moduleIndex, "label"], event.currentTarget.value)} />
                </Field>
                <Field label="Amount">
                  <NumberInput value={module.amount} onChange={(value) => updateField(["modules", moduleIndex, "amount"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Month">
                  <NumberInput value={module.month} onChange={(value) => updateField(["modules", moduleIndex, "month"], Math.max(0, Math.round(value)))} min={0} step={1} />
                </Field>
                <Field label="Flow kind">
                  <SelectInput value={module.eventType} onChange={(value) => updateField(["modules", moduleIndex, "eventType"], value)}>
                    <option value="expense">Expense</option>
                    <option value="ordinary_income">After-tax income</option>
                  </SelectInput>
                </Field>
              </div>
            ) : null}

            {module.type === "scheduledTransfer" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Label">
                  <Input value={module.label} onChange={(event) => updateField(["modules", moduleIndex, "label"], event.currentTarget.value)} />
                </Field>
                <Field label="Amount">
                  <NumberInput value={module.amount} onChange={(value) => updateField(["modules", moduleIndex, "amount"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Source account">
                  <SelectInput value={module.sourceAccountId} onChange={(value) => updateField(["modules", moduleIndex, "sourceAccountId"], value)}>
                    {accountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Destination account">
                  <SelectInput value={module.destinationAccountId} onChange={(value) => updateField(["modules", moduleIndex, "destinationAccountId"], value)}>
                    {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Start month">
                  <NumberInput value={module.startMonth} onChange={(value) => updateField(["modules", moduleIndex, "startMonth"], Math.max(0, Math.round(value)))} min={0} step={1} />
                </Field>
                <Field label="End month">
                  <Input
                    type="number"
                    value={module.endMonth ?? ""}
                    min={0}
                    step={1}
                    onChange={(event) => handleNullableMonthChange(event, (value) => updateField(["modules", moduleIndex, "endMonth"], value))}
                  />
                </Field>
                <Field label="Frequency months">
                  <NumberInput value={module.frequencyMonths} onChange={(value) => updateField(["modules", moduleIndex, "frequencyMonths"], Math.max(1, Math.round(value)))} min={1} step={1} />
                </Field>
                <Field label="Direction">
                  <SelectInput value={String(module.destinationDeltaSign)} onChange={(value) => updateField(["modules", moduleIndex, "destinationDeltaSign"], Number(value) as 1 | -1)}>
                    <option value="1">Increase destination</option>
                    <option value="-1">Reduce destination</option>
                  </SelectInput>
                </Field>
                <Field label="Event type">
                  <SelectInput value={module.eventType} onChange={(value) => updateField(["modules", moduleIndex, "eventType"], value)}>
                    <option value="transfer">Transfer</option>
                    <option value="debt_payment">Debt payment</option>
                  </SelectInput>
                </Field>
              </div>
            ) : null}

            {module.type === "retirementPlan" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Destination account">
                  <SelectInput value={module.destinationAccountId} onChange={(value) => updateField(["modules", moduleIndex, "destinationAccountId"], value)}>
                    {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Annual employee limit">
                  <NumberInput value={module.annualEmployeeLimit} onChange={(value) => updateField(["modules", moduleIndex, "annualEmployeeLimit"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Employee contribution %">
                  <PercentInput value={module.employeeContributionRate} onChange={(value) => updateField(["modules", moduleIndex, "employeeContributionRate"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Employer match %">
                  <PercentInput value={module.employerMatchRate} onChange={(value) => updateField(["modules", moduleIndex, "employerMatchRate"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Employer match limit %">
                  <PercentInput value={module.employerMatchLimitRate} onChange={(value) => updateField(["modules", moduleIndex, "employerMatchLimitRate"], Math.max(0, value))} min={0} />
                </Field>
                <div className="md:col-span-2">
                  <CheckboxInput
                    checked={module.firstMonthOverride.enabled}
                    onChange={(checked) => updateField(["modules", moduleIndex, "firstMonthOverride", "enabled"], checked)}
                    label="Use actual first-month retirement contributions instead of the modeled contribution and match."
                  />
                </div>
                <Field label="First-month employee contribution">
                  <NumberInput value={module.firstMonthOverride.employeeContribution} onChange={(value) => updateField(["modules", moduleIndex, "firstMonthOverride", "employeeContribution"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="First-month employer contribution">
                  <NumberInput value={module.firstMonthOverride.employerContribution} onChange={(value) => updateField(["modules", moduleIndex, "firstMonthOverride", "employerContribution"], Math.max(0, value))} min={0} />
                </Field>
              </div>
            ) : null}

            {module.type === "equityGrantSeries" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Destination account">
                    <SelectInput value={module.destinationAccountId} onChange={(value) => updateField(["modules", moduleIndex, "destinationAccountId"], value)}>
                      {destinationAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </SelectInput>
                  </Field>
                  <Field label="Employee months at start">
                    <NumberInput value={module.employeeMonthsAtProjectionStart} onChange={(value) => updateField(["modules", moduleIndex, "employeeMonthsAtProjectionStart"], Math.max(0, Math.round(value)))} min={0} step={1} />
                  </Field>
                  <Field label="Initial grant value">
                    <NumberInput value={module.initialGrantValue} onChange={(value) => updateField(["modules", moduleIndex, "initialGrantValue"], Math.max(0, value))} min={0} />
                  </Field>
                  <Field label="Refresh grant value">
                    <NumberInput value={module.refreshGrantValue} onChange={(value) => updateField(["modules", moduleIndex, "refreshGrantValue"], Math.max(0, value))} min={0} />
                  </Field>
                  <Field label="First refresh grant month">
                    <NumberInput value={module.firstRefreshGrantMonth} onChange={(value) => updateField(["modules", moduleIndex, "firstRefreshGrantMonth"], Math.max(0, Math.round(value)))} min={0} step={1} />
                  </Field>
                  <Field label="Refresh frequency months">
                    <NumberInput value={module.refreshFrequencyMonths} onChange={(value) => updateField(["modules", moduleIndex, "refreshFrequencyMonths"], Math.max(1, Math.round(value)))} min={1} step={1} />
                  </Field>
                  <Field label="Salary-linked annual base salary">
                    <NumberInput value={module.annualBaseSalary} onChange={(value) => updateField(["modules", moduleIndex, "annualBaseSalary"], Math.max(0, value))} min={0} />
                  </Field>
                  <Field label="Salary-linked annual raise %">
                    <PercentInput value={module.annualRaiseRate} onChange={(value) => updateField(["modules", moduleIndex, "annualRaiseRate"], Math.max(0, value))} min={0} />
                  </Field>
                  <Field label="Salary-linked refresh % of base">
                    <PercentInput value={module.salaryLinkedRefreshPctOfBase} onChange={(value) => updateField(["modules", moduleIndex, "salaryLinkedRefreshPctOfBase"], Math.max(0, value))} min={0} />
                  </Field>
                  <div className="md:col-span-2">
                    <CheckboxInput
                      checked={module.useSalaryGrowthForRefreshers}
                      onChange={(checked) => updateField(["modules", moduleIndex, "useSalaryGrowthForRefreshers"], checked)}
                      label="Scale refresher grants using the linked salary and salary-linked percentage instead of a fixed refresh grant amount."
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h4 className="font-medium text-slate-900">Vesting schedule</h4>
                      <p className="text-sm text-slate-500">Each row is a month offset and percentage of the grant value.</p>
                    </div>
                    <button
                      type="button"
                      className={sectionButtonClassName()}
                      onClick={() => updateScenario((current) => ({
                        ...current,
                        modules: current.modules.map((currentModule, index) => {
                          if (index !== moduleIndex || currentModule.type !== "equityGrantSeries") return currentModule;
                          return {
                            ...currentModule,
                            vestingSchedule: [...currentModule.vestingSchedule, { monthOffset: 0, pct: 0 }],
                          };
                        }),
                      }))}
                    >
                      Add vest row
                    </button>
                  </div>

                  <div className="space-y-3">
                    {module.vestingSchedule.map((vestingRow, vestingIndex) => (
                      <div key={`${module.id}-vesting-${vestingIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                        <Field label="Month offset">
                          <NumberInput value={vestingRow.monthOffset} onChange={(value) => updateField(["modules", moduleIndex, "vestingSchedule", vestingIndex, "monthOffset"], Math.max(0, Math.round(value)))} min={0} step={1} />
                        </Field>
                        <Field label="Percent of grant">
                          <PercentInput value={vestingRow.pct} onChange={(value) => updateField(["modules", moduleIndex, "vestingSchedule", vestingIndex, "pct"], Math.max(0, value))} min={0} />
                        </Field>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className={sectionButtonClassName("danger")}
                            onClick={() => updateScenario((current) => ({
                              ...current,
                              modules: current.modules.map((currentModule, index) => {
                                if (index !== moduleIndex || currentModule.type !== "equityGrantSeries") return currentModule;
                                return {
                                  ...currentModule,
                                  vestingSchedule: currentModule.vestingSchedule.filter((_, indexToKeep) => indexToKeep !== vestingIndex),
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
                </div>
              </div>
            ) : null}

            {module.type === "tax" ? (
              <p className="text-sm text-slate-600">Uses the built-in US federal 2026 tax model and allocates liability across supported income sources before the generic runtime executes cash movements.</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
