import type {
  DashboardViewModel,
  ProjectionResult,
  ProjectionScenario,
  ScenarioPath,
} from "../lib/projection";
import {
  compensationFields,
  contributionSliderFields,
  currentBalanceFields,
  firstMonthContributionFields,
  firstMonthContributionToggleField,
  firstMonthPaycheckFields,
  firstMonthPaycheckToggleField,
  fixedExpenseFields,
  matchFields,
  projectionSettingsFields,
  returnSliderFields,
  salaryGrowthToggleField,
  studentLoanFields,
  studentLoanPriorityToggleField,
} from "../lib/projection";
import type { ScenarioFieldDefinition } from "../lib/projection/formSchema";
import { currency, pct } from "../lib/format";
import { ScenarioField } from "./ScenarioField";
import { Card, CardContent } from "./ui";

interface ProjectionControlsProps {
  scenario: ProjectionScenario;
  result: ProjectionResult;
  dashboard: DashboardViewModel;
  updateField: (path: ScenarioPath, value: unknown) => void;
}

function renderFieldGrid(
  scenario: ProjectionScenario,
  fields: ScenarioFieldDefinition[],
  updateField: (path: ScenarioPath, value: unknown) => void,
  className = "grid grid-cols-2 gap-4"
) {
  return (
    <div className={className}>
      {fields.map((field) => (
        <ScenarioField key={field.path.join(".")} scenario={scenario} field={field} updateField={updateField} />
      ))}
    </div>
  );
}

export function ProjectionControls({ scenario, result, dashboard, updateField }: ProjectionControlsProps) {
  return (
    <Card className="rounded-2xl shadow-sm lg:col-span-1">
      <CardContent className="p-6 space-y-6">
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Compensation</h2>
          {renderFieldGrid(scenario, compensationFields, updateField)}
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <ScenarioField scenario={scenario} field={salaryGrowthToggleField} updateField={updateField} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Actual first-month paycheck</h2>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <ScenarioField scenario={scenario} field={firstMonthPaycheckToggleField} updateField={updateField} />
          </div>
          {renderFieldGrid(scenario, firstMonthPaycheckFields, updateField)}
          <div className="rounded-xl bg-slate-50 p-3 space-y-3 text-sm text-slate-600">
            <ScenarioField scenario={scenario} field={firstMonthContributionToggleField} updateField={updateField} />
            {renderFieldGrid(scenario, firstMonthContributionFields, updateField)}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold">Current balances</h2>
          {renderFieldGrid(scenario, currentBalanceFields, updateField)}
        </div>

        {contributionSliderFields.map((field) => (
          <ScenarioField key={field.path.join(".")} scenario={scenario} field={field} updateField={updateField} />
        ))}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Student loan</h2>
          {renderFieldGrid(scenario, studentLoanFields, updateField)}
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <ScenarioField scenario={scenario} field={studentLoanPriorityToggleField} updateField={updateField} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">Fixed monthly obligations</h2>
          {renderFieldGrid(scenario, fixedExpenseFields, updateField)}
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex justify-between gap-4"><span>Total fixed obligations</span><strong className="text-slate-900">{currency.format(result.totals.monthlyFixedExpenses)} / mo</strong></div>
            <div className="flex justify-between gap-4"><span>Max feasible extra contribution</span><strong className="text-slate-900">{currency.format(result.cashFlow.firstMonthMaxExtraFundContribution)} / mo</strong></div>
            <div className="flex justify-between gap-4"><span>Max feasible x</span><strong className="text-slate-900">{pct.format(result.cashFlow.firstMonthMaxExtraFundPct)}</strong></div>
            {dashboard.extraContributionIsCapped ? (
              <p className="mt-2 text-amber-700">Requested x is above the modeled cash-flow maximum, so contributions are capped at available cash after fixed obligations.</p>
            ) : null}
          </div>
        </div>

        {returnSliderFields.map((field) => (
          <ScenarioField key={field.path.join(".")} scenario={scenario} field={field} updateField={updateField} />
        ))}

        {renderFieldGrid(scenario, matchFields, updateField)}
        {renderFieldGrid(scenario, projectionSettingsFields, updateField, "grid grid-cols-1 gap-4")}
      </CardContent>
    </Card>
  );
}
