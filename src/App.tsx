import { Suspense, lazy } from "react";
import { ProjectionActions } from "./components/ProjectionActions";
import { ProjectionControls } from "./components/ProjectionControls";
import { LedgerControls } from "./components/LedgerControls";
import { useProjectionScenario } from "./hooks/useProjectionScenario";
import { useLedgerCheckpoints } from "./hooks/useLedgerCheckpoints";
import { useProjectionWorker } from "./hooks/useProjectionWorker";

const ProjectionDashboard = lazy(() => import("./components/ProjectionDashboard"));

export default function App() {
  const {
    scenario,
    scenarioRevision,
    importError,
    syncScenario,
    resetScenario,
    importScenario,
    exportScenario,
  } = useProjectionScenario();

  const { checkpoints, csvError, importCsv, clearCheckpoints } = useLedgerCheckpoints();
  const { validation, result, dashboard, eventSummary, runtimeError, isProjecting } = useProjectionWorker(scenario, checkpoints);

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">When will net worth reach $1M?</h1>
          <p className="max-w-3xl text-slate-500">
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

        <LedgerControls 
          checkpointsCount={checkpoints.length} 
          csvError={csvError} 
          onImportCsv={importCsv} 
          onClear={clearCheckpoints} 
        />

        <div className="space-y-8">
          <ProjectionControls
            scenario={scenario}
            scenarioRevision={scenarioRevision}
            validationIssues={validation.issues}
            onScenarioChange={syncScenario}
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
                result={result}
                dashboard={dashboard}
                eventSummary={eventSummary}
              />
            ) : (
              <div className="lg:col-span-2 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
                {runtimeError ?? "The scenario could not be projected. Fix the validation issues in the builder and try again."}
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
