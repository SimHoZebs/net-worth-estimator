import { useState } from "react";
import type { ScenarioPack } from "@/lib/projection";
import { formatFrequency } from "@/lib/format";
import { useStore } from "@/store";

export function AssumptionList({ pack }: { pack: ScenarioPack }) {
  const [showFormulas, setShowFormulas] = useState(false);
  const disabledPostingIds = useStore((s) => s.disabledPostingIds);
  const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
  const disabledSet = new Set(disabledPostingIds);
  const incomePostings = pack.postings.filter((p) => !p.sourceAccountId);
  const expensePostings = pack.postings.filter((p) => p.sourceAccountId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Showing {showFormulas ? "raw formulas" : "plain-language descriptions"}
        </div>
        <button
          type="button"
          onClick={() => setShowFormulas(!showFormulas)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200"
        >
          {showFormulas ? "Hide formulas" : "Show formulas"}
        </button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Income</h4>
          <div className="space-y-1">
            {incomePostings.length > 0 ? (
              incomePostings.map((p) => {
                const isDisabled = disabledSet.has(p.id);
                return (
                  <div key={p.id} className={`flex items-center justify-between rounded-lg px-2 py-1 text-sm transition ${isDisabled ? "opacity-40" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => togglePostingDisabled(p.id)}
                        className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                          isDisabled ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" : "border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100"
                        }`}
                        title={isDisabled ? "Enable this posting" : "Disable this posting (what-if)"}
                      >
                        {isDisabled ? null : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className={`text-slate-700 dark:text-slate-300 ${isDisabled ? "line-through" : ""}`}>{p.label}</span>
                    </div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {showFormulas ? `${p.arithmetic} (${formatFrequency(p.frequency)})` : `${formatFrequency(p.frequency)} inflow${isDisabled ? "" : ""}`}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400 dark:text-slate-500">No external income scheduled.</div>
            )}
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Expenses & transfers</h4>
          <div className="space-y-1">
            {expensePostings.length > 0 ? (
              expensePostings.map((p) => {
                const isDisabled = disabledSet.has(p.id);
                return (
                  <div key={p.id} className={`flex items-center justify-between rounded-lg px-2 py-1 text-sm transition ${isDisabled ? "opacity-40" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => togglePostingDisabled(p.id)}
                        className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                          isDisabled ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" : "border-slate-900 bg-slate-900"
                        }`}
                        title={isDisabled ? "Enable this posting" : "Disable this posting (what-if)"}
                      >
                        {isDisabled ? null : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className={`text-slate-700 dark:text-slate-300 ${isDisabled ? "line-through" : ""}`}>{p.label}</span>
                    </div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {showFormulas ? `${p.arithmetic} (${formatFrequency(p.frequency)})` : `${formatFrequency(p.frequency)} outflow`}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400 dark:text-slate-500">No outgoing transactions scheduled.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
