import { useEffect, useMemo } from "react";
import { ScenarioInspector } from "./components/CsvScenarioInspector";
import { ProjectionDashboard } from "./components/CsvProjectionDashboard";
import { ContributionWhatIfControls } from "./components/CsvContributionWhatIfControls";
import { StochasticControls } from "./components/StochasticControls";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { useProjection } from "./hooks/useProjection";
import { useStochastic } from "./hooks/useStochastic";
import { summarizeValidationIssues } from "./lib/projection";
import { useStore, selectWhatIfState } from "./store";
import { useShallow } from "zustand/shallow";
import { createCsvDataSource } from "@/lib/projection";
import { useScenarioQuery, useScenarioMutation } from "./hooks/useScenario";

const PROJECTION_HORIZON_YEARS = 25;

function formatTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const dataSource = useMemo(() => createCsvDataSource(), []);
  const {
    data: scenarioData,
    isLoading: isScenarioLoading,
    error: scenarioError,
    refetch: refetchScenario,
    dataUpdatedAt,
  } = useScenarioQuery(dataSource);
  const scenarioMutation = useScenarioMutation(dataSource);

  const pack = scenarioData?.pack ?? null;
  const issues = scenarioData?.issues ?? [];
  const loadError = scenarioError?.message ?? null;
  const isLoading = isScenarioLoading;

  const whatIfState = useStore(useShallow(selectWhatIfState));
  const activeOverrideCount = useStore(
    (s) =>
      s.addedAccounts.length +
      s.addedPostings.length +
      s.addedCheckpoints.length +
      s.disabledAccountIds.length +
      s.disabledPostingIds.length,
  );

  const targetNetWorthInput = useStore((s) => s.targetNetWorthInput);
  const setTargetNetWorthInput = useStore((s) => s.setTargetNetWorthInput);
  const stochasticEnabled = useStore((s) => s.stochasticEnabled);
  const stochasticConfig = useStore((s) => s.stochasticConfig);
  const setStochasticEnabled = useStore((s) => s.setStochasticEnabled);

  const validation = summarizeValidationIssues(issues);
  const fallbackProjectionStartDate = useMemo(() => formatTodayIsoDate(), []);
  const targetNetWorth = Number.isFinite(Number(targetNetWorthInput)) ? Number(targetNetWorthInput) : 0;
  const projectionSettings = useMemo(
    () => ({
      targetNetWorth,
      fallbackProjectionStartDate,
      horizonYears: PROJECTION_HORIZON_YEARS,
    }),
    [fallbackProjectionStartDate, targetNetWorth],
  );
  const projectionStartDate = pack?.checkpoints.reduce<string | null>(
    (latestDate, checkpoint) =>
      latestDate === null || checkpoint.Date > latestDate ? checkpoint.Date : latestDate,
    null,
  ) ?? fallbackProjectionStartDate;
  const { result, runtimeError, isRunning: isProjecting } = useProjection(
    pack,
    projectionSettings,
    whatIfState,
    validation.isValid,
  );

  const hasStochasticAccounts =
    pack !== null && pack.postings.some((p) => p.volatility > 0 && p.enabled);

  useEffect(() => {
    if (hasStochasticAccounts && validation.isValid) {
      setStochasticEnabled(true);
    }
  }, [hasStochasticAccounts, validation.isValid, setStochasticEnabled]);

  const stochasticWorkerEnabled = stochasticEnabled && hasStochasticAccounts && validation.isValid;
  const {
    result: stochasticResult,
    runtimeError: stochasticError,
    isRunning: isStochasticRunning,
    progress: stochasticProgress,
  } = useStochastic(pack, projectionSettings, whatIfState, stochasticConfig, stochasticWorkerEnabled);

  const handleSave = () => {
    const store = useStore.getState();
    if (!store.workingPack || scenarioMutation.isPending) return;

    scenarioMutation.mutate(store.workingPack, {
      onSuccess: () => {
        useStore.setState({
          isDirty: false,
          isEditing: false,
          workingPack: null,
        });
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => refetchScenario()} disabled={isLoading}>
            {isLoading ? "Loading..." : "Reload"}
          </Button>
        </div>

        {isProjecting ? (
          <Alert className="rounded-[1.6rem] border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Updating projection</AlertTitle>
            <AlertDescription className="text-amber-950/80">
              Recomputing historical and projected balances from the loaded data pack
              {activeOverrideCount > 0
                ? ` with ${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"}`
                : ""}
              .
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
            projectionSettings={projectionSettings}
            targetNetWorthInput={targetNetWorthInput}
            onTargetNetWorthInputChange={setTargetNetWorthInput}
            stochasticResult={stochasticResult}
          >
            <ContributionWhatIfControls pack={pack} />
          </ProjectionDashboard>
        ) : null}

        {pack && validation.isValid && result ? (
          <StochasticControls hasStochasticAccounts={hasStochasticAccounts} stochasticResult={stochasticResult} isRunning={isStochasticRunning} progress={stochasticProgress} />
        ) : null}

        <ScenarioInspector
          projectionSettings={projectionSettings}
          projectionStartDate={result?.milestones.projectionStartDate ?? projectionStartDate}
          pack={pack}
          issues={issues}
          isLoading={isLoading}
          loadError={loadError}
          dataUpdatedAt={dataUpdatedAt}
          onReload={() => refetchScenario()}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
