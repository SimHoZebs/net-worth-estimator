import { Suspense, lazy, useDeferredValue, useMemo } from "react";
import { ProjectionActions } from "./components/ProjectionActions";
import { ProjectionControls } from "./components/ProjectionControls";
import { project, selectDashboardModel, summarizeEventsByType, summarizeValidationIssues, validateScenario } from "./lib/projection";
import { useProjectionScenario } from "./hooks/useProjectionScenario";

const ProjectionDashboard = lazy(() => import("./components/ProjectionDashboard"));

export default function App() {
  const {
    scenario,
    importError,
    updateField,
    updateScenario,
    resetScenario,
    importScenario,
    exportScenario,
  } = useProjectionScenario();
  const deferredScenario = useDeferredValue(scenario);
  const validation = useMemo(() => summarizeValidationIssues(validateScenario(scenario)), [scenario]);

  const result = useMemo(() => {
    if (!validation.isValid) return null;

    try {
      return project(deferredScenario);
    } catch {
      return null;
    }
  }, [deferredScenario, validation.isValid]);
  const dashboard = useMemo(() => (
    result ? selectDashboardModel(result, deferredScenario) : null
  ), [result, deferredScenario]);
  const eventSummary = useMemo(() => (
    result ? summarizeEventsByType(result.events.all) : []
  ), [result]);
  const isProjecting = deferredScenario !== scenario;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">When will net worth reach $1M?</h1>
          <p className="text-slate-600 max-w-3xl">
            A ledger-style projection where salary, RSUs, 401(k), match, taxes, expenses, debt payments, transfers, and shortfalls are modeled as dated events processed by one projection engine.
          </p>
        </div>

        <ProjectionActions
          importError={importError}
          isProjecting={isProjecting}
          onImport={importScenario}
          onExport={exportScenario}
          onReset={resetScenario}
        />

        <div className="space-y-8">
          <ProjectionControls
            scenario={scenario}
            validationIssues={validation.issues}
            updateField={updateField}
            updateScenario={updateScenario}
          />
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                Loading projection dashboard...
              </div>
            }
          >
            {result && dashboard ? (
              <ProjectionDashboard
                scenario={deferredScenario}
                result={result}
                dashboard={dashboard}
                eventSummary={eventSummary}
              />
            ) : (
              <div className="lg:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 shadow-sm">
                The scenario could not be projected. Fix the validation issues in the builder and try again.
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
