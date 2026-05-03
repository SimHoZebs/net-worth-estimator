import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useStore, type ScenarioSnapshot } from "@/store";
import { currency, pct, formatDate } from "@/lib/format";

export function ScenarioComparison() {
  const snapshots = useStore((s) => s.snapshots);
  const addSnapshot = useStore((s) => s.addSnapshot);
  const removeSnapshot = useStore((s) => s.removeSnapshot);
  const clearSnapshots = useStore((s) => s.clearSnapshots);
  const [labelInput, setLabelInput] = useState("");

  return (
    <CollapsibleSection
      title="Scenario snapshots"
      description={snapshots.length > 0 ? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} saved` : "Save the current projection to compare with future changes."}
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
                whatIfState: { ...useStore.getState() },
                metrics: {
                  currentNetWorth: 0,
                  finalNetWorth: 0,
                  hitTargetDate: null,
                  shortfallAmount: 0,
                  overrideCount: 0,
                },
              });
              setLabelInput("");
            }}
          >
            Take snapshot
          </Button>
          {snapshots.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearSnapshots}>
              Clear all
            </Button>
          ) : null}
        </div>

        {snapshots.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Overrides</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((sn) => (
                  <tr key={sn.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{sn.label}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(new Date(sn.timestamp).toISOString().slice(0, 10))}</td>
                    <td className="px-4 py-3 text-slate-500">{sn.metrics.overrideCount}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeSnapshot(sn.id)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400">
              Snapshots store what-if configuration only. Re-run after restoring to see updated results.
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
