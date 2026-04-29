import { useMemo, useState } from "react";
import { ProjectionControls } from "./components/ProjectionControls";
import { ProjectionDashboard } from "./components/ProjectionDashboard";
import { DEFAULT_FORM_STATE, buildAssumptionsFromState, project, summarizeEventsByType } from "./lib/projection";
import type { ProjectionFormState } from "./lib/projection";

export default function App() {
  const [form, setForm] = useState<ProjectionFormState>(DEFAULT_FORM_STATE);

  const assumptions = useMemo(() => buildAssumptionsFromState(form), [form]);
  const result = useMemo(() => project(assumptions), [assumptions]);
  const eventSummary = useMemo(() => summarizeEventsByType(result.allEvents), [result.allEvents]);

  const requestedExtraFundContribution = result.firstMonthAfterTaxCashAfter401k * (form.extraInvestmentPct / 100);
  const extraContributionIsCapped = requestedExtraFundContribution > result.firstMonthMaxExtraFundContribution + 1;

  const updateField = <Key extends keyof ProjectionFormState>(field: Key, value: ProjectionFormState[Key]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">When will net worth reach $1M?</h1>
          <p className="text-slate-600 max-w-3xl">
            A ledger-style projection where salary, RSUs, 401(k), match, taxes, expenses, debt payments, transfers, and shortfalls are modeled as dated events processed by one projection engine.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ProjectionControls
            form={form}
            result={result}
            extraContributionIsCapped={extraContributionIsCapped}
            updateField={updateField}
          />
          <ProjectionDashboard
            maxYears={form.maxYears}
            result={result}
            eventSummary={eventSummary}
          />
        </div>
      </div>
    </div>
  );
}
