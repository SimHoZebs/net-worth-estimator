import { Suspense, lazy, useDeferredValue, useMemo } from "react";
import { ProjectionActions } from "./components/ProjectionActions";
import { ProjectionControls } from "./components/ProjectionControls";
import { buildProjectionInput, project, selectDashboardModel, summarizeEventsByType } from "./lib/projection";
import { useProjectionScenario } from "./hooks/useProjectionScenario";

const ProjectionDashboard = lazy(() => import("./components/ProjectionDashboard"));

export default function App() {
  const {
    scenario,
    importError,
    updateField,
    resetScenario,
    importScenario,
    exportScenario,
  } = useProjectionScenario();
  const deferredScenario = useDeferredValue(scenario);

  const projectionInput = useMemo(() => buildProjectionInput(deferredScenario), [deferredScenario]);
  const result = useMemo(() => project(projectionInput), [projectionInput]);
  const dashboard = useMemo(() => selectDashboardModel(result, deferredScenario), [result, deferredScenario]);
  const eventSummary = useMemo(() => summarizeEventsByType(result.events.all), [result.events.all]);
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ProjectionControls
            scenario={scenario}
            result={result}
            dashboard={dashboard}
            updateField={updateField}
          />
          <Suspense
            fallback={
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                Loading projection dashboard...
              </div>
            }
          >
            <ProjectionDashboard
              result={result}
              dashboard={dashboard}
              eventSummary={eventSummary}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
