import { useEffect, useMemo, useState } from "react";
import { ScenarioInspector } from "./components/CsvScenarioInspector";
import { ProjectionDashboard } from "./components/CsvProjectionDashboard";
import { ContributionWhatIfControls } from "./components/CsvContributionWhatIfControls";
import { StochasticControls } from "./components/StochasticControls";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { useWhatIfState } from "./hooks/useWhatIfState";
import { useProjectionWorker } from "./hooks/useProjectionWorker";
import { useScenarioPack } from "./hooks/useScenarioPack";
import { useStochasticWorker } from "./hooks/useStochasticWorker";
import { useScenarioEditor } from "./hooks/useScenarioEditor";
import { createCsvDataSource, summarizeValidationIssues } from "./lib/projection";
import type { StochasticConfig } from "./lib/projection";

const DEFAULT_TARGET_NET_WORTH = 1_000_000;
const PROJECTION_HORIZON_YEARS = 25;
const DEFAULT_STOCHASTIC_RUN_COUNT = 1000;

function formatTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const dataSource = useMemo(() => createCsvDataSource(), []);
  const { pack, issues, loadError, isLoading, loadedAt, reload } = useScenarioPack(dataSource);
  const [targetNetWorthInput, setTargetNetWorthInput] = useState(String(DEFAULT_TARGET_NET_WORTH));
  const {
    state: whatIfState,
    activeOverrideCount,
    resetAllOverrides,
    addTemporaryAccount,
    removeTemporaryAccount,
    addTemporaryPosting,
    removeTemporaryPosting,
    addTemporaryCheckpoint,
    removeTemporaryCheckpoint,
    toggleAccountDisabled,
    togglePostingDisabled,
  } = useWhatIfState();
  const editor = useScenarioEditor(pack);
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
  const { result, runtimeError, isRunning: isProjecting } = useProjectionWorker(pack, projectionSettings, whatIfState, validation.isValid);

  const hasStochasticAccounts = pack !== null && pack.accounts.some((a) => a.volatility > 0 && a.enabled);
  const [stochasticEnabled, setStochasticEnabled] = useState(false);
  const [stochasticConfig, setStochasticConfig] = useState<StochasticConfig>({
    runCount: DEFAULT_STOCHASTIC_RUN_COUNT,
    seed: null,
  });

  useEffect(() => {
    if (hasStochasticAccounts && validation.isValid) {
      setStochasticEnabled(true);
    }
  }, [hasStochasticAccounts, validation.isValid]);

  const stochasticWorkerEnabled = stochasticEnabled && hasStochasticAccounts && validation.isValid;
  const { result: stochasticResult, runtimeError: stochasticError, isRunning: isStochasticRunning } = useStochasticWorker(
    pack,
    projectionSettings,
    whatIfState,
    stochasticConfig,
    stochasticWorkerEnabled
  );

  const handleSave = async () => {
    if (!editor.workingPack) return;
    await dataSource.savePack(editor.workingPack);
    editor.markSaved();
    void reload();
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => void reload()} disabled={isLoading}>
            {isLoading ? "Loading..." : "Reload"}
          </Button>
        </div>

        {isProjecting ? (
          <Alert className="rounded-[1.6rem] border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Updating projection</AlertTitle>
            <AlertDescription className="text-amber-950/80">
              Recomputing historical and projected balances from the loaded data pack{activeOverrideCount > 0 ? ` with ${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"}` : ""}.
            </AlertDescription>
          </Alert>
        ) : null}

        {!validation.isValid ? (
            <Alert variant="destructive" className="rounded-[1.6rem]">
              <AlertTitle>Projection blocked by validation errors</AlertTitle>
              <AlertDescription>
                Fix the data pack issues above, then reload the data to resume projection.
              </AlertDescription>
            </Alert>
        ) : null}

        {stochasticError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Stochastic simulation failed</AlertTitle>
            <AlertDescription>{stochasticError}</AlertDescription>
          </Alert>
        ) : null}

        {runtimeError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Projection failed</AlertTitle>
            <AlertDescription>{runtimeError}</AlertDescription>
          </Alert>
        ) : null}

        {pack && validation.isValid && result ? (
          <ProjectionDashboard
            pack={pack}
            result={result}
            whatIfState={whatIfState}
            projectionSettings={projectionSettings}
            targetNetWorthInput={targetNetWorthInput}
            onTargetNetWorthInputChange={setTargetNetWorthInput}
            stochasticResult={stochasticResult}
          >
            <ContributionWhatIfControls
              pack={pack}
              whatIfState={whatIfState}
              activeOverrideCount={activeOverrideCount}
              onResetAllOverrides={resetAllOverrides}
              onAddTemporaryAccount={addTemporaryAccount}
              onRemoveTemporaryAccount={removeTemporaryAccount}
              onAddTemporaryPosting={addTemporaryPosting}
              onRemoveTemporaryPosting={removeTemporaryPosting}
              onAddTemporaryCheckpoint={addTemporaryCheckpoint}
              onRemoveTemporaryCheckpoint={removeTemporaryCheckpoint}
            />
          </ProjectionDashboard>
        ) : null}

        {pack && validation.isValid && result ? (
          <StochasticControls
            enabled={stochasticEnabled}
            onToggle={setStochasticEnabled}
            config={stochasticConfig}
            onConfigChange={setStochasticConfig}
            isRunning={isStochasticRunning}
            hasStochasticAccounts={hasStochasticAccounts}
            stochasticResult={stochasticResult}
          />
        ) : null}

        <ScenarioInspector
          pack={pack}
          issues={issues}
          loadError={loadError}
          isLoading={isLoading}
          loadedAt={loadedAt}
          projectionSettings={projectionSettings}
          projectionStartDate={result?.milestones.projectionStartDate ?? projectionStartDate}
          onReload={() => { void reload(); }}
          whatIfState={whatIfState}
          onToggleAccountDisabled={toggleAccountDisabled}
          onTogglePostingDisabled={togglePostingDisabled}
          editor={editor}
          dataSource={dataSource}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
