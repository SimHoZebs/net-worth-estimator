import { useMemo, useState } from "react";
import { CsvScenarioInspector } from "./components/CsvScenarioInspector";
import { CsvProjectionDashboard } from "./components/CsvProjectionDashboard";
import { CsvPostingWhatIfControls } from "./components/CsvContributionWhatIfControls";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { useCsvWhatIfState } from "./hooks/useCsvWhatIfState";
import { useCsvProjectionWorker } from "./hooks/useCsvProjectionWorker";
import { useCsvScenarioPack } from "./hooks/useCsvScenarioPack";
import { summarizeValidationIssues } from "./lib/projection";

const DEFAULT_TARGET_NET_WORTH = 1_000_000;
const PROJECTION_HORIZON_YEARS = 50;

function formatTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const { pack, issues, loadError, isLoading, loadedAt, reload } = useCsvScenarioPack();
  const [targetNetWorthInput, setTargetNetWorthInput] = useState(String(DEFAULT_TARGET_NET_WORTH));
  const {
    state: whatIfState,
    activeOverrideCount,
    setPostingMultiplier,
    clearPostingOverride,
    resetAllOverrides,
  } = useCsvWhatIfState();
  const validation = summarizeValidationIssues(issues);
  const fallbackProjectionStartDate = useMemo(() => formatTodayIsoDate(), []);
  const targetNetWorth = Number.isFinite(Number(targetNetWorthInput)) ? Number(targetNetWorthInput) : 0;
  const projectionSettings = useMemo(
    () => ({
      targetNetWorth,
      fallbackProjectionStartDate,
      horizonYears: PROJECTION_HORIZON_YEARS,
    }),
    [fallbackProjectionStartDate, targetNetWorth]
  );
  const projectionStartDate = pack?.checkpoints.reduce<string | null>(
    (latestDate, checkpoint) => latestDate === null || checkpoint.Date > latestDate ? checkpoint.Date : latestDate,
    null
  ) ?? fallbackProjectionStartDate;
  const { result, runtimeError, isProjecting } = useCsvProjectionWorker(pack, projectionSettings, whatIfState, validation.isValid);

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">CSV-Backed Net Worth Model</h1>
          <p className="max-w-3xl text-slate-500">
            Prioritize the planning questions first: whether the target is reachable, which scheduled cash movements matter, and what changes the projection. The raw CSV pack remains available as reference below.
          </p>
        </div>

        {isProjecting ? (
          <Alert className="rounded-[1.6rem] border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Updating projection</AlertTitle>
            <AlertDescription className="text-amber-950/80">
              Recomputing historical and projected balances from the loaded CSV pack{activeOverrideCount > 0 ? ` with ${activeOverrideCount} temporary override${activeOverrideCount === 1 ? "" : "s"}` : ""}.
            </AlertDescription>
          </Alert>
        ) : null}

        {!validation.isValid ? (
            <Alert variant="destructive" className="rounded-[1.6rem]">
              <AlertTitle>Projection blocked by CSV validation errors</AlertTitle>
              <AlertDescription>
                Fix the CSV pack issues above, then reload the data to resume projection.
              </AlertDescription>
            </Alert>
        ) : null}

        {runtimeError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Projection failed</AlertTitle>
            <AlertDescription>{runtimeError}</AlertDescription>
          </Alert>
        ) : null}

        {pack && validation.isValid && result ? (
          <CsvProjectionDashboard
            pack={pack}
            result={result}
            whatIfState={whatIfState}
            projectionSettings={projectionSettings}
            targetNetWorthInput={targetNetWorthInput}
            onTargetNetWorthInputChange={setTargetNetWorthInput}
          />
        ) : null}

        {pack ? (
          <CsvPostingWhatIfControls
            pack={pack}
            whatIfState={whatIfState}
            activeOverrideCount={activeOverrideCount}
            onSetPostingMultiplier={setPostingMultiplier}
            onClearPostingOverride={clearPostingOverride}
            onResetAllOverrides={resetAllOverrides}
          />
        ) : null}

        <CsvScenarioInspector
          pack={pack}
          issues={issues}
          loadError={loadError}
          isLoading={isLoading}
          loadedAt={loadedAt}
          projectionSettings={projectionSettings}
          projectionStartDate={result?.milestones.projectionStartDate ?? projectionStartDate}
          onReload={() => {
            void reload();
          }}
        />
      </div>
    </div>
  );
}
