import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { useStore, type SnapshotMetrics } from "@/store";
import { currency, pct, formatDate } from "@/lib/format";

interface ScenarioComparisonProps {
  currentMetrics: SnapshotMetrics;
  currentOverrideCount: number;
}

export function ScenarioComparison({ currentMetrics, currentOverrideCount }: ScenarioComparisonProps) {
  const snapshots = useStore((s) => s.snapshots);
  const addSnapshotFromCurrentScenario = useStore((s) => s.addSnapshotFromCurrentScenario);
  const removeSnapshot = useStore((s) => s.removeSnapshot);
  const clearSnapshots = useStore((s) => s.clearSnapshots);
  const [labelInput, setLabelInput] = useState("");

  const hasSnapshots = snapshots.length > 0;

  return (
    <Collapsible defaultOpen={false}>
      <Collapsible.Trigger>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Collapsible.Chevron />
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">Scenario snapshots</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {hasSnapshots ? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} saved. Save the current projection to compare with future changes.` : "Save the current projection to compare with future changes."}
              </div>
            </div>
          </div>
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 transition-colors group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-300">
            Show details
          </span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Baseline (no overrides)"
              className="w-full max-w-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-400"
            />
            <Button
              type="button"
              size="sm"
              disabled={!labelInput.trim()}
              onClick={() => {
                addSnapshotFromCurrentScenario(labelInput.trim(), currentMetrics);
                setLabelInput("");
              }}
            >
              Take snapshot
            </Button>
            {hasSnapshots ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearSnapshots}>
                Clear all
              </Button>
            ) : null}
          </div>

          {hasSnapshots ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-left text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Current NW</th>
                    <th className="px-4 py-3">Final NW</th>
                    <th className="px-4 py-3">Target date</th>
                    <th className="px-4 py-3">Overrides</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((sn) => {
                    const sameCurrent = sn.metrics.currentNetWorth === currentMetrics.currentNetWorth;
                    const sameFinal = sn.metrics.finalNetWorth === currentMetrics.finalNetWorth;
                    return (
                      <tr key={sn.id} className="border-b border-slate-100 dark:border-slate-700 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{sn.label}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-900 dark:text-slate-100">{currency.format(sn.metrics.currentNetWorth)}</td>
                        <td className={`px-4 py-3 tabular-nums ${sameFinal ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>
                          {currency.format(sn.metrics.finalNetWorth)}
                        </td>
                        <td className="px-4 py-3 text-slate-900 dark:text-slate-100">
                          {sn.metrics.hitTargetDate ? formatDate(sn.metrics.hitTargetDate) : "Beyond horizon"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-500 dark:text-slate-400">{sn.metrics.overrideCount}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => removeSnapshot(sn.id)}
                              className="text-xs text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">Current</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-slate-900 dark:text-slate-100">{currency.format(currentMetrics.currentNetWorth)}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-slate-900 dark:text-slate-100">{currency.format(currentMetrics.finalNetWorth)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {currentMetrics.hitTargetDate ? formatDate(currentMetrics.hitTargetDate) : "Beyond horizon"}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-slate-900 dark:text-slate-100">{currentOverrideCount}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
                Snapshots store what-if configuration. To restore, manually apply the override counts shown above.
              </div>
            </div>
          ) : null}
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}
