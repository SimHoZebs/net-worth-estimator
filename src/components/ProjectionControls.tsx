import type { ChangeEvent } from "react";
import type {
  AllocationOverrideStep,
  AllocationPolicyDefinition,
  AllocationPolicyStep,
  ScenarioAccountDefinition,
  ScenarioDefinition,
  ScenarioModule,
  ScenarioPath,
} from "../lib/projection";
import { Card, CardContent, Input, Label } from "./ui";

interface ProjectionControlsProps {
  scenario: ScenarioDefinition;
  updateField: (path: ScenarioPath, value: unknown) => void;
  updateScenario: (updater: (current: ScenarioDefinition) => ScenarioDefinition) => void;
}

interface FieldProps {
  label: string;
  helper?: string;
  children: React.ReactNode;
}

const SINGLETON_MODULE_TYPES = new Set<ScenarioModule["type"]>([
  "employmentIncome",
  "retirementPlan",
  "tax",
]);

function sectionButtonClassName(kind: "primary" | "secondary" | "danger" = "secondary"): string {
  switch (kind) {
    case "primary":
      return "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700";
    case "danger":
      return "rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50";
    case "secondary":
    default:
      return "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50";
  }
}

function Field({ label, helper, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function NumberInput({ value, onChange, step = "any", min }: { value: number; onChange: (nextValue: number) => void; step?: number | string; min?: number }) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      onChange={(event) => onChange(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0)}
    />
  );
}

function PercentInput({ value, onChange, step = 0.5, min = 0, max }: { value: number; onChange: (nextValue: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value * 100) ? value * 100 : 0}
      step={step}
      min={min}
      max={max}
      onChange={(event) => onChange((Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0) / 100)}
    />
  );
}

function SelectInput({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {children}
    </select>
  );
}

function CheckboxInput({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

function createId(prefix: string, existingIds: string[]): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let suffix = existingIds.length + 1;
  let candidate = `${normalizedPrefix}-${suffix}`;

  while (existingIds.includes(candidate)) {
    suffix += 1;
    candidate = `${normalizedPrefix}-${suffix}`;
  }

  return candidate;
}

function moduleTitle(type: ScenarioModule["type"]): string {
  switch (type) {
    case "employmentIncome":
      return "Employment income";
    case "retirementPlan":
      return "Retirement plan";
    case "recurringFlow":
      return "Recurring flow";
    case "equityGrantSeries":
      return "Equity grant series";
    case "tax":
      return "Tax module";
    default:
      return type;
  }
}

function accountKindLabel(kind: ScenarioAccountDefinition["kind"]): string {
  switch (kind) {
    case "cash":
      return "Cash";
    case "liability":
      return "Liability";
    case "asset":
    default:
      return "Asset";
  }
}

function scenarioHasModuleType(scenario: ScenarioDefinition, type: ScenarioModule["type"]): boolean {
  return scenario.modules.some((module) => module.type === type);
}

function isAccountReferenced(scenario: ScenarioDefinition, accountId: string): boolean {
  return scenario.modules.some((module) => {
    switch (module.type) {
      case "retirementPlan":
      case "equityGrantSeries":
        return module.destinationAccountId === accountId;
      default:
        return false;
    }
  }) || scenario.allocationPolicies.some((policy) => (
    policy.sourceAccountId === accountId ||
    policy.steps.some((step) => step.destinationAccountId === accountId) ||
    policy.overrides.some((override) => override.steps.some((step) => step.destinationAccountId === accountId))
  ));
}

function addAccount(scenario: ScenarioDefinition, kind: ScenarioAccountDefinition["kind"]): ScenarioDefinition {
  const nextId = createId(kind, scenario.accounts.map((account) => account.id));
  const nextAccount: ScenarioAccountDefinition = {
    id: nextId,
    label: kind === "liability" ? "New liability" : "New account",
    kind,
    openingBalance: 0,
    annualRate: 0,
    color: kind === "liability" ? "#dc2626" : "#2563eb",
    minBalance: 0,
  };

  return {
    ...scenario,
    accounts: [...scenario.accounts, nextAccount],
  };
}

function addModule(scenario: ScenarioDefinition, type: ScenarioModule["type"]): ScenarioDefinition {
  const existingIds = scenario.modules.map((module) => module.id);
  const assetAccountId = scenario.accounts.find((account) => account.kind === "asset")?.id ?? scenario.accounts[0]?.id ?? "cash";
  const liabilityAccountId = scenario.accounts.find((account) => account.kind === "liability")?.id ?? assetAccountId;

  const nextModule: ScenarioModule = (() => {
    switch (type) {
      case "employmentIncome":
        return {
          id: createId("employment", existingIds),
          type,
          annualBaseSalary: 120000,
          annualRaiseRate: 0.03,
          firstMonthActualPaycheck: {
            enabled: false,
            regularGross: 0,
            signingBonus: 0,
            takeHome: 0,
          },
        };
      case "retirementPlan":
        return {
          id: createId("retirement-plan", existingIds),
          type,
          destinationAccountId: assetAccountId,
          annualEmployeeLimit: 24500,
          employeeContributionRate: 0.04,
          employerMatchRate: 0.5,
          employerMatchLimitRate: 0.04,
          firstMonthOverride: {
            enabled: false,
            employeeContribution: 0,
            employerContribution: 0,
          },
        };
      case "equityGrantSeries":
        return {
          id: createId("equity-grants", existingIds),
          type,
          destinationAccountId: assetAccountId,
          employeeMonthsAtProjectionStart: 0,
          initialGrantValue: 0,
          refreshGrantValue: 0,
          firstRefreshGrantMonth: 12,
          refreshFrequencyMonths: 12,
          useSalaryGrowthForRefreshers: false,
          annualRaiseRate: 0.03,
          annualBaseSalary: 120000,
          salaryLinkedRefreshPctOfBase: 0.25,
          vestingSchedule: [
            { monthOffset: 12, pct: 0.25 },
            { monthOffset: 24, pct: 0.25 },
            { monthOffset: 36, pct: 0.25 },
            { monthOffset: 48, pct: 0.25 },
          ],
        };
      case "tax":
        return {
          id: createId("taxes", existingIds),
          type,
        };
      case "recurringFlow":
      default:
        return {
          id: createId("recurring-flow", existingIds),
          type: "recurringFlow",
          label: "New recurring flow",
          amount: 0,
          startMonth: 0,
          endMonth: null,
          eventType: "expense",
          source: createId("flow", [...existingIds, liabilityAccountId]),
          taxTreatment: "after-tax",
        };
    }
  })();

  return {
    ...scenario,
    modules: [...scenario.modules, nextModule],
  };
}

function addPolicy(scenario: ScenarioDefinition): ScenarioDefinition {
  const sourceAccountId = scenario.accounts.find((account) => account.kind === "cash")?.id ?? scenario.accounts[0]?.id ?? "cash";
  const destinationAccountId = scenario.accounts.find((account) => account.kind !== "cash")?.id ?? sourceAccountId;

  return {
    ...scenario,
    allocationPolicies: [
      ...scenario.allocationPolicies,
      {
        id: createId("policy", scenario.allocationPolicies.map((policy) => policy.id)),
        sourceAccountId,
        rateOfAvailable: 0.1,
        sweepRemainderFromSource: true,
        steps: [{ destinationAccountId, destinationDeltaSign: 1, mode: "allRemaining" }],
        overrides: [],
      },
    ],
  };
}

function addPolicyStep(policy: AllocationPolicyDefinition, destinationAccountId: string): AllocationPolicyDefinition {
  return {
    ...policy,
    steps: [...policy.steps, { destinationAccountId, destinationDeltaSign: 1, mode: "allRemaining" }],
  };
}

function addPolicyOverride(policy: AllocationPolicyDefinition, destinationAccountId: string): AllocationPolicyDefinition {
  return {
    ...policy,
    overrides: [
      ...policy.overrides,
      {
        month: 0,
        steps: [{ destinationAccountId, destinationDeltaSign: 1, amount: 0 }],
      },
    ],
  };
}

function addOverrideStep(steps: AllocationOverrideStep[], destinationAccountId: string): AllocationOverrideStep[] {
  return [...steps, { destinationAccountId, destinationDeltaSign: 1, amount: 0 }];
}

function handleNullableMonthChange(event: ChangeEvent<HTMLInputElement>, onChange: (value: number | null) => void) {
  const nextValue = event.currentTarget.value.trim();
  onChange(nextValue === "" ? null : Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : null);
}

export function ProjectionControls({ scenario, updateField, updateScenario }: ProjectionControlsProps) {
  const removableAccounts = scenario.accounts.filter((account) => account.id !== "cash");
  const accountOptions = scenario.accounts.map((account) => ({
    value: account.id,
    label: `${account.label} (${accountKindLabel(account.kind)})`,
  }));
  const destinationAccountOptions = scenario.accounts
    .filter((account) => account.kind !== "cash")
    .map((account) => ({ value: account.id, label: `${account.label} (${accountKindLabel(account.kind)})` }));

  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-1">
      <CardContent className="space-y-6 p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Scenario</h2>
              <p className="text-sm text-slate-500">Edit the canonical scenario document directly. Modules compile into generic runtime instructions.</p>
            </div>
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

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Accounts</h2>
              <p className="text-sm text-slate-500">These are the balances the runtime mutates over time.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addAccount(current, "asset"))}>Add asset</button>
              <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addAccount(current, "liability"))}>Add liability</button>
            </div>
          </div>
          <div className="space-y-4">
            {scenario.accounts.map((account, accountIndex) => {
              const accountIsReferenced = isAccountReferenced(scenario, account.id);
              const isCashAccount = account.id === "cash";

              return (
                <div key={account.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-slate-900">{account.label}</h3>
                      <p className="text-xs text-slate-500">ID: <code>{account.id}</code></p>
                    </div>
                    <button
                      type="button"
                      className={sectionButtonClassName("danger")}
                      disabled={isCashAccount || accountIsReferenced}
                      onClick={() => updateScenario((current) => ({
                        ...current,
                        accounts: current.accounts.filter((_, index) => index !== accountIndex),
                      }))}
                    >
                      Remove
                    </button>
                  </div>
                  {isCashAccount ? <p className="text-xs text-slate-500">Cash is the default liquidity pool for policy execution and cannot be removed.</p> : null}
                  {!isCashAccount && accountIsReferenced ? <p className="text-xs text-amber-700">This account is currently referenced by a module or policy, so remove or retarget those references first.</p> : null}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Label">
                      <Input value={account.label} onChange={(event) => updateField(["accounts", accountIndex, "label"], event.currentTarget.value)} />
                    </Field>
                    <Field label="Kind">
                      <SelectInput
                        value={account.kind}
                        onChange={(value) => updateField(["accounts", accountIndex, "kind"], value)}
                      >
                        <option value="cash" disabled={!isCashAccount}>Cash</option>
                        <option value="asset">Asset</option>
                        <option value="liability">Liability</option>
                      </SelectInput>
                    </Field>
                    <Field label="Opening balance">
                      <NumberInput value={account.openingBalance} onChange={(value) => updateField(["accounts", accountIndex, "openingBalance"], Math.max(0, value))} min={0} />
                    </Field>
                    <Field label="Annual rate %" helper="Positive balances grow upward; liabilities accrue upward and reduce net worth.">
                      <PercentInput value={account.annualRate ?? 0} onChange={(value) => updateField(["accounts", accountIndex, "annualRate"], Math.max(0, value))} min={0} />
                    </Field>
                    <Field label="Color" helper="Used in charts.">
                      <Input value={account.color ?? ""} onChange={(event) => updateField(["accounts", accountIndex, "color"], event.currentTarget.value)} />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Built-in modules</h2>
              <p className="text-sm text-slate-500">Modules compile human concepts into generic operations, rate rules, and tax/liquidity behavior.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["employmentIncome", "recurringFlow", "retirementPlan", "equityGrantSeries", "tax"] satisfies ScenarioModule["type"][]).map((type) => {
                const isSingleton = SINGLETON_MODULE_TYPES.has(type);
                const isDisabled = isSingleton && scenarioHasModuleType(scenario, type);

                return (
                  <button
                    key={type}
                    type="button"
                    className={sectionButtonClassName()}
                    disabled={isDisabled}
                    onClick={() => updateScenario((current) => addModule(current, type))}
                  >
                    Add {moduleTitle(type)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {scenario.modules.map((module, moduleIndex) => (
              <div key={module.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">{moduleTitle(module.type)}</h3>
                    <p className="text-xs text-slate-500">ID: <code>{module.id}</code></p>
                  </div>
                  <button
                    type="button"
                    className={sectionButtonClassName("danger")}
                    onClick={() => updateScenario((current) => ({
                      ...current,
                      modules: current.modules.filter((_, index) => index !== moduleIndex),
                    }))}
                  >
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
                  <p className="text-sm text-slate-600">Uses the built-in US federal 2026 tax model and allocates liability across salary and equity vest income before the generic runtime executes cash movements.</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Allocation policies</h2>
              <p className="text-sm text-slate-500">Policies tell the runtime how to allocate available source-account cash after base operations have executed.</p>
            </div>
            <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addPolicy(current))}>Add policy</button>
          </div>

          <div className="space-y-4">
            {scenario.allocationPolicies.map((policy, policyIndex) => (
              <div key={policy.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">Policy {policyIndex + 1}</h3>
                    <p className="text-xs text-slate-500">ID: <code>{policy.id}</code></p>
                  </div>
                  <button
                    type="button"
                    className={sectionButtonClassName("danger")}
                    onClick={() => updateScenario((current) => ({
                      ...current,
                      allocationPolicies: current.allocationPolicies.filter((_, index) => index !== policyIndex),
                    }))}
                  >
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
                    <PercentInput value={policy.rateOfAvailable} onChange={(value) => updateField(["allocationPolicies", policyIndex, "rateOfAvailable"], Math.max(0, Math.min(1, value)))} min={0} max={100} />
                  </Field>
                  <div className="md:col-span-2">
                    <CheckboxInput
                      checked={policy.sweepRemainderFromSource}
                      onChange={(checked) => updateField(["allocationPolicies", policyIndex, "sweepRemainderFromSource"], checked)}
                      label="Sweep any leftover source-account cash out of the runtime after the allocation steps run. This keeps unallocated residual cash from carrying forward."
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

        {removableAccounts.length === 0 ? (
          <p className="text-sm text-slate-500">Add non-cash accounts, built-in modules, and allocation policies to build a new scenario from scratch.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
