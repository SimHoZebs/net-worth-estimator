import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useStore, type ScenarioSnapshot, type SnapshotMetrics } from "@/store";
import { currency, pct, formatDate } from "@/lib/format";

interface ScenarioComparisonProps {
  currentMetrics: SnapshotMetrics;
  currentOverrideCount: number;
}

export function ScenarioComparison({ currentMetrics, currentOverrideCount }: ScenarioComparisonProps) {
  const snapshots = useStore((s) => s.snapshots);
  const addSnapshot = useStore((s) => s.addSnapshot);
  const removeSnapshot = useStore((s) => s.removeSnapshot);
  const clearSnapshots = useStore((s) => s.clearSnapshots);
  const [labelInput, setLabelInput] = useState("");

  const hasSnapshots = snapshots.length > 0;

  return (
    <CollapsibleSection
      title="Scenario snapshots"
      description={hasSnapshots ? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} saved. Save the current projection to compare with future changes.` : "Save the current projection to compare with future changes."}
      defaultOpen={false}
    >
      <div className="mt-5 space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="Baseline (no overrides)"
            className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
          />
          <Button
            type="button"
            size="sm"
            disabled={!labelInput.trim()}
            onClick={() => {
              addSnapshot({
                id: "snap-" + Date.now(),
                label: labelInput.trim(),
                timestamp: Date.now(),
                whatIfState: useStore.getState(),
                metrics: { ...currentMetrics },
              });
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
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500">
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
                    <tr key={sn.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{sn.label}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-900">{currency.format(sn.metrics.currentNetWorth)}</td>
                      <td className={`px-4 py-3 tabular-nums ${sameFinal ? "text-slate-400" : "text-slate-900"}`}>
                        {currency.format(sn.metrics.finalNetWorth)}
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {sn.metrics.hitTargetDate ? formatDate(sn.metrics.hitTargetDate) : "Beyond horizon"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">{sn.metrics.overrideCount}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => removeSnapshot(sn.id)}
                            className="text-xs text-slate-400 hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">Current</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{currency.format(currentMetrics.currentNetWorth)}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{currency.format(currentMetrics.finalNetWorth)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {currentMetrics.hitTargetDate ? formatDate(currentMetrics.hitTargetDate) : "Beyond horizon"}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{currentOverrideCount}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400">
              Snapshots store what-if configuration. To restore, manually apply the override counts shown above.
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
