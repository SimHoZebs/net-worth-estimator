import { CsvScenarioInspector } from "./components/CsvScenarioInspector";
import { CsvProjectionDashboard } from "./components/CsvProjectionDashboard";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { useCsvProjectionWorker } from "./hooks/useCsvProjectionWorker";
import { useCsvScenarioPack } from "./hooks/useCsvScenarioPack";
import { summarizeValidationIssues } from "./lib/projection";

export default function App() {
  const { pack, issues, loadError, isLoading, loadedAt, reload } = useCsvScenarioPack();
  const validation = summarizeValidationIssues(issues);
  const { result, runtimeError, isProjecting } = useCsvProjectionWorker(pack, validation.isValid);

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">CSV-Backed Net Worth Model</h1>
          <p className="max-w-3xl text-slate-500">
            Historical truth now comes from account checkpoints, and future planning will come from tracked account balances, contribution plans, transfers, and account growth. Budget rows are loaded for investable-capacity math only.
          </p>
        </div>

        <CsvScenarioInspector
          pack={pack}
          issues={issues}
          loadError={loadError}
          isLoading={isLoading}
          loadedAt={loadedAt}
          onReload={() => {
            void reload();
          }}
        />

        {isProjecting ? (
          <Alert className="rounded-[1.6rem] border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Updating projection</AlertTitle>
            <AlertDescription className="text-amber-950/80">
              Recomputing historical and projected balances from the loaded CSV pack.
            </AlertDescription>
          </Alert>
        ) : null}

        {!validation.isValid ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Projection blocked by CSV validation errors</AlertTitle>
            <AlertDescription>
              Fix the CSV pack issues above, then reload the scenario to resume projection.
            </AlertDescription>
          </Alert>
        ) : null}

        {runtimeError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Projection failed</AlertTitle>
            <AlertDescription>{runtimeError}</AlertDescription>
          </Alert>
        ) : null}

        {pack && validation.isValid && result ? <CsvProjectionDashboard pack={pack} result={result} /> : null}
      </div>
    </div>
  );
}
