import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStore, type ScenarioSnapshot } from "@/store";
import { currency, pct, formatDate } from "@/lib/format";

function SnapshotRow({ label, current, snapshot }: { label: string; current: string | number; snapshot: string | number }) {
  const same = String(current) === String(snapshot);
  return (
    <div className="grid grid-cols-3 gap-2 border-b border-slate-100 py-2 text-sm last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${same ? "text-slate-400" : "text-slate-900"}`}>{current}</span>
      <span className={`font-medium ${same ? "text-slate-400" : "text-blue-700"}`}>{snapshot}</span>
    </div>
  );
}

export function ScenarioComparison() {
  const snapshots = useStore((s) => s.snapshots);
  const addSnapshot = useStore((s) => s.addSnapshot);
  const removeSnapshot = useStore((s) => s.removeSnapshot);
  const clearSnapshots = useStore((s) => s.clearSnapshots);
  const whatIfState = useStore((s) => ({
    addedAccounts: s.addedAccounts,
    addedPostings: s.addedPostings,
    addedCheckpoints: s.addedCheckpoints,
    disabledAccountIds: s.disabledAccountIds,
    disabledPostingIds: s.disabledPostingIds,
  }));
  const activeOverrideCount = useStore(
    (s) =>
      s.addedAccounts.length +
      s.addedPostings.length +
      s.addedCheckpoints.length +
      s.disabledAccountIds.length +
      s.disabledPostingIds.length,
  );
  const [labelInput, setLabelInput] = useState("");

  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Scenario Snapshots</CardTitle>
            <CardDescription>Save and compare different what-if scenarios against the current projection.</CardDescription>
          </div>
          <div className="flex items-center gap-2 no-print">
            {snapshots.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearSnapshots}>Clear all</Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {snapshots.length === 0 ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-500">
              No snapshots yet. Save the current projection result to compare with future changes.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Baseline (no overrides)"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
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
                    whatIfState: { ...whatIfState },
                    result: {} as any,
                    stochasticResult: null,
                  });
                  setLabelInput("");
                }}
              >
                Take snapshot
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Name this snapshot..."
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
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
                    whatIfState: { ...whatIfState },
                    result: {} as any,
                    stochasticResult: null,
                  });
                  setLabelInput("");
                }}
              >
                Take snapshot
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    <th className="pb-2 pr-4">Snapshot</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Overrides</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((sn) => (
                    <tr key={sn.id} className="border-b border-slate-100">
                      <td className="py-2 pr-4 font-medium text-slate-900">{sn.label}</td>
                      <td className="py-2 pr-4 text-slate-500">{formatDate(sn.timestamp ? new Date(sn.timestamp).toISOString().slice(0, 10) : "")}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {sn.whatIfState.addedAccounts.length +
                          sn.whatIfState.addedPostings.length +
                          sn.whatIfState.addedCheckpoints.length +
                          sn.whatIfState.disabledAccountIds.length +
                          sn.whatIfState.disabledPostingIds.length}
                      </td>
                      <td className="py-2 text-right">
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
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
