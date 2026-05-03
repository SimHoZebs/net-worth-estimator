import { useEffect, useMemo, useState } from "react";
import { ScenarioInspector } from "./components/CsvScenarioInspector";
import { ProjectionDashboard } from "./components/CsvProjectionDashboard";
import { ContributionWhatIfControls } from "./components/CsvContributionWhatIfControls";
import { StochasticControls } from "./components/StochasticControls";
import { ScenarioComparison } from "./components/ScenarioComparison";
import { TemplateWizard } from "./components/patterns/TemplateWizard";
import { SectionNav } from "./components/SectionNav";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { useProjection } from "./hooks/useProjection";
import { useStochastic } from "./hooks/useStochastic";
import { summarizeValidationIssues } from "./lib/projection";
import { useStore, selectWhatIfState } from "./store";
import { useShallow } from "zustand/shallow";
import { createCsvDataSource } from "@/lib/projection";
import { useScenarioQuery, useScenarioMutation } from "./hooks/useScenario";

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
  const isEditing = useStore((s) => s.isEditing);
  const isDirty = useStore((s) => s.isDirty);

  const targetNetWorthInput = useStore((s) => s.targetNetWorthInput);
  const setTargetNetWorthInput = useStore((s) => s.setTargetNetWorthInput);
  const horizonYears = useStore((s) => s.horizonYears);
  const setHorizonYears = useStore((s) => s.setHorizonYears);
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
      horizonYears,
    }),
    [fallbackProjectionStartDate, targetNetWorth, horizonYears],
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

  const [showWizard, setShowWizard] = useState(false);

  const handleApplyTemplate = (output: import("@/lib/patterns").TemplateOutput) => {
    const store = useStore.getState();
    if (!store.isEditing && pack) {
      store.startEditing(pack);
    }
    for (const account of output.accounts) {
      store.addAccount(account);
    }
    for (const posting of output.postings) {
      store.addPosting(posting);
    }
  };

  const [showPrintSummary, setShowPrintSummary] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-0 px-0 md:px-0">
        <div className="px-4 py-4 md:px-8">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500">
              {pack ? (
                <span>
                  Baseline loaded from <span className="font-mono text-slate-600">/scenario</span>
                  {activeOverrideCount > 0 ? ` · ${activeOverrideCount} temporary scenario override${activeOverrideCount === 1 ? "" : "s"}` : ""}
                  {isEditing && isDirty ? " · Unsaved baseline edits" : ""}
                  {isEditing && !isDirty ? " · Editing baseline" : ""}
                  {activeOverrideCount === 0 && !isEditing ? " · Projection settings are session-only" : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                  Loading scenario data...
                </span>
              )}
            </div>
            <div className="flex gap-2 no-print">
              <Button type="button" variant="ghost" size="sm" onClick={() => window.print()} disabled={!pack}>
                Print
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => refetchScenario()} disabled={isLoading}>
                {isLoading ? "Loading..." : "Reload source data"}
              </Button>
              {pack ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowWizard(true)}>
                  Templates
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <SectionNav />

        <div className="space-y-6 px-4 py-6 md:px-8">
        {isLoading && !pack ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-2 h-3 w-20 rounded bg-slate-200" />
                <div className="h-6 w-32 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-24 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        ) : null}

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
            onProjectionSettingsChange={(partial) => {
              if (partial.horizonYears !== undefined) setHorizonYears(partial.horizonYears);
            }}
            stochasticResult={stochasticResult}
          >
            <ContributionWhatIfControls pack={pack} />
          </ProjectionDashboard>
        ) : null}

        {pack && validation.isValid && result ? (
          <section id="monte-carlo">
            <StochasticControls hasStochasticAccounts={hasStochasticAccounts} stochasticResult={stochasticResult} isRunning={isStochasticRunning} progress={stochasticProgress} />
          </section>
        ) : null}

        <ScenarioComparison />

        <section id="source-data">
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
        </section>

        {showWizard && pack ? (
          <TemplateWizard
            pack={pack}
            onApply={handleApplyTemplate}
            onClose={() => setShowWizard(false)}
          />
        ) : null}
      </div>
    </div>
  </div>
  );
}
