import { useEffect, useRef, useState } from "react";
import type { StochasticConfig, StochasticProjectionResult } from "@/lib/projection";
import { pct, currency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent } from "@/components/ui/card";

interface StochasticControlsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  config: StochasticConfig;
  onConfigChange: (config: StochasticConfig) => void;
  isRunning: boolean;
  hasStochasticAccounts: boolean;
  stochasticResult: StochasticProjectionResult | null;
}

const DEBOUNCE_MS = 2000;

export function StochasticControls({
  enabled,
  onToggle,
  config,
  onConfigChange,
  isRunning,
  hasStochasticAccounts,
  stochasticResult,
}: StochasticControlsProps) {
  const [runCountInput, setRunCountInput] = useState(String(config.runCount));
  const [seedInput, setSeedInput] = useState(config.seed !== null ? String(config.seed) : "");
  const [pendingConfig, setPendingConfig] = useState<StochasticConfig | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedRunCount = Number.isFinite(Number(runCountInput))
    ? Math.max(1, Math.min(10000, Number(runCountInput)))
    : config.runCount;
  const parsedSeed = seedInput.trim().length > 0 && Number.isFinite(Number(seedInput))
    ? Number(seedInput)
    : null;

  const hasPendingChanges = pendingConfig !== null;

  function scheduleConfigChange(nextConfig: StochasticConfig) {
    setPendingConfig(nextConfig);

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onConfigChange(nextConfig);
      setPendingConfig(null);
      debounceRef.current = null;
    }, DEBOUNCE_MS);
  }

  function applyImmediately() {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const nextConfig: StochasticConfig = {
      runCount: parsedRunCount,
      seed: parsedSeed,
    };

    onConfigChange(nextConfig);
    setPendingConfig(null);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const statusLabel = isRunning
    ? `Computing ${config.runCount} projections…`
    : stochasticResult
      ? `Ready — ${config.runCount} run${config.runCount === 1 ? "" : "s"}${config.seed !== null ? ` (seed ${config.seed})` : ""}`
      : enabled
        ? "Waiting to start…"
        : "Disabled";

  return (
    <CollapsibleSection
      title="Monte Carlo simulation"
      description={enabled && hasStochasticAccounts
        ? statusLabel
        : enabled && !hasStochasticAccounts
          ? "No postings have volatility configured. Set volatility > 0 to enable simulation."
          : "Stochastic simulation is disabled. Toggle on to see probabilistic bands."}
      badge={isRunning ? "Running…" : enabled ? "Open" : "Off"}
    >

      <div className="mt-5 space-y-4">
        {/* Toggle row */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-slate-900">Enable Monte Carlo simulation</div>
            <div className="text-xs text-slate-500">
              {hasStochasticAccounts
                ? "Show probabilistic bands on the trend chart."
                : "Add volatility to a posting to use this feature."}
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              onChange={(e) => onToggle(e.currentTarget.checked)}
              disabled={!hasStochasticAccounts}
            />
            <div className="peer h-6 w-11 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-slate-900 peer-checked:after:translate-x-full peer-disabled:opacity-40" />
          </label>
        </div>

        {enabled && hasStochasticAccounts ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Run count</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  value={runCountInput}
                  onChange={(e) => {
                    setRunCountInput(e.currentTarget.value);
                    scheduleConfigChange({
                      runCount: Number.isFinite(Number(e.currentTarget.value))
                        ? Math.max(1, Math.min(10000, Number(e.currentTarget.value)))
                        : config.runCount,
                      seed: parsedSeed,
                    });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Seed (optional)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={seedInput}
                  onChange={(e) => {
                    setSeedInput(e.currentTarget.value);
                    const nextSeed = e.currentTarget.value.trim().length > 0 && Number.isFinite(Number(e.currentTarget.value))
                      ? Number(e.currentTarget.value)
                      : null;
                    scheduleConfigChange({
                      runCount: parsedRunCount,
                      seed: nextSeed,
                    });
                  }}
                  placeholder="Random"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={applyImmediately}
                  disabled={!hasPendingChanges && !isRunning}
                  variant={hasPendingChanges ? "default" : "secondary"}
                >
                  {hasPendingChanges ? "Re-run now" : isRunning ? "Running…" : "Re-run now"}
                </Button>
              </div>
            </div>

            {stochasticResult ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Hit probability</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{pct.format(stochasticResult.milestones.hitTargetProbability)}</div>
                    <div className="text-xs text-slate-500">chance of reaching target</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">P50 hit date</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{stochasticResult.milestones.medianHitTargetDate ?? "Never"}</div>
                    <div className="text-xs text-slate-500">50th percentile</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">P10 hit date</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{stochasticResult.milestones.worstCaseHitTargetDate ?? "Never"}</div>
                    <div className="text-xs text-slate-500">worst case (10th %ile)</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Final P50</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p50)}</div>
                    <div className="text-xs text-slate-500">
                      range {currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p10)}–{currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p90)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
