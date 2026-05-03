import type { Account, Posting, ProjectionRow } from "@/lib/projection";
import { currency } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ShortfallMonthDetailProps {
  monthKey: string;
  monthLabel: string;
  monthRows: ProjectionRow[];
  rows: ProjectionRow[];
  postingById: Record<string, Posting>;
  postingLabelById: Record<string, string>;
  accounts: Account[];
}

export function ShortfallMonthDetail({
  monthKey, monthLabel, monthRows, rows, postingById, postingLabelById, accounts,
}: ShortfallMonthDetailProps) {
  const monthStart = monthKey + "-01";
  let prevRow: ProjectionRow | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date < monthStart) { prevRow = rows[i]; break; }
  }

  const monthlyRequested: Record<string, number> = {};
  const monthlyRealized: Record<string, number> = {};

  for (const mr of monthRows) {
    for (const [id, amount] of Object.entries(mr.requestedPostingAmountsById)) {
      monthlyRequested[id] = (monthlyRequested[id] ?? 0) + amount;
    }
    for (const [id, amount] of Object.entries(mr.realizedPostingAmountsById)) {
      monthlyRealized[id] = (monthlyRealized[id] ?? 0) + amount;
    }
  }

  const lastMonthRow = monthRows[monthRows.length - 1];

  interface CascadeStep {
    postingId: string;
    label: string;
    delta: number;
    requested: number;
    realized: number;
    runningBalance: number;
    shortfallAmount: number;
    isShortfall: boolean;
  }

  const { cascadeAccounts, cascadeStepsByAccount } = (() => {
    const map = new Map<string, CascadeStep[]>();
    const constrainedAccountIds = new Set<string>();

    for (const mr of monthRows) {
      for (const snap of mr.accountSnapshots) {
        if (snap.impacts.length === 0) continue;
        for (const impact of snap.impacts) {
          const shortfallAmount = Math.max(0, (monthlyRequested[impact.postingId] ?? 0) - (monthlyRealized[impact.postingId] ?? 0));
          const isShortfall = shortfallAmount > 0;
          if (isShortfall && postingById[impact.postingId]?.sourceAccountId) {
            constrainedAccountIds.add(postingById[impact.postingId]!.sourceAccountId!);
          }
          if (!map.has(snap.accountId)) map.set(snap.accountId, []);
          map.get(snap.accountId)!.push({
            postingId: impact.postingId,
            label: postingLabelById[impact.postingId] ?? impact.postingId,
            delta: impact.delta,
            requested: mr.requestedPostingAmountsById[impact.postingId] ?? 0,
            realized: mr.realizedPostingAmountsById[impact.postingId] ?? 0,
            runningBalance: 0,
            shortfallAmount,
            isShortfall,
          });
        }
      }
    }

    for (const [accountId, steps] of map) {
      steps.sort((a, b) => (postingById[a.postingId]?.priority ?? 0) - (postingById[b.postingId]?.priority ?? 0));
      const start = prevRow?.accountSnapshots.find(s => s.accountId === accountId)?.balance ?? 0;
      let running = start;
      for (const step of steps) {
        running += step.delta;
        step.runningBalance = running;
      }
    }

    const cascadeRows = accounts
      .filter(a => a.enabled && map.has(a.id))
      .sort((a, b) => {
        const aConstrained = constrainedAccountIds.has(a.id);
        const bConstrained = constrainedAccountIds.has(b.id);
        if (aConstrained !== bConstrained) return aConstrained ? -1 : 1;
        return a.label.localeCompare(b.label);
      });

    return { cascadeAccounts: cascadeRows, cascadeStepsByAccount: map };
  })();

  return (
    <TableRow>
      <TableCell colSpan={7} className="border-b-2 border-slate-100 bg-slate-50 p-0">
        <div className="px-8 pb-2 pt-1 space-y-2">
          <div className="text-sm font-semibold text-slate-700">Cash flow for {monthLabel}</div>

          {cascadeAccounts.map((account) => {
            const steps = cascadeStepsByAccount.get(account.id) ?? [];
            const startBalance = prevRow?.accountSnapshots.find(s => s.accountId === account.id)?.balance ?? 0;
            const endBalance = lastMonthRow?.accountSnapshots.find(s => s.accountId === account.id)?.balance ?? 0;
            const change = endBalance - startBalance;
            const changeColor = change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-slate-400";
            const accountsWithSteps = steps.length > 0;

            return (
              <details key={account.id} className="rounded-lg border border-slate-100 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <span className="flex items-center gap-2">
                    {account.color ? <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: account.color }} /> : null}
                    {account.label}
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    {accountsWithSteps ? (
                      <>
                        <span>{currency.format(startBalance)} → {currency.format(endBalance)}</span>
                        <span className={changeColor}>{change > 0 ? "+" : ""}{currency.format(change)}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">{currency.format(endBalance)}</span>
                    )}
                    <svg className="h-3 w-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </summary>
                {accountsWithSteps ? (
                  <div className="border-t border-slate-100 px-3 pb-2 pt-1">
                    <Table>
                      <TableBody>
                        <TableRow className="border-b-0">
                          <TableCell className="w-4 text-xs text-slate-400"></TableCell>
                          <TableCell className="text-xs font-medium text-slate-500">Start</TableCell>
                          <TableCell className="text-xs text-right text-slate-400"></TableCell>
                          <TableCell className="text-xs text-right text-slate-400"></TableCell>
                          <TableCell className="text-xs text-right text-slate-400"></TableCell>
                          <TableCell className="text-xs text-right font-medium text-slate-700">{currency.format(startBalance)}</TableCell>
                        </TableRow>
                        {steps.map((step, idx) => {
                          const signColor = step.delta > 0 ? "text-emerald-600" : "text-red-600";
                          return (
                          <TableRow key={`${step.postingId}-${idx}`} className="border-b-0">
                            <TableCell className={`w-4 text-xs ${signColor}`}>
                              {step.delta > 0 ? "+" : "−"}
                            </TableCell>
                            <TableCell className={`text-xs ${signColor}`}>
                              {step.label}
                              {step.isShortfall ? (
                                <span className="ml-2 inline-flex items-center gap-1 font-medium text-amber-700">⚠ Shortfall {currency.format(step.shortfallAmount)}</span>
                              ) : null}
                            </TableCell>
                            <TableCell className={`text-xs text-right ${signColor}`}>{currency.format(step.requested)}</TableCell>
                            <TableCell className={`text-xs text-right ${signColor}`}>{currency.format(step.realized)}</TableCell>
                            <TableCell className={`text-xs text-right font-medium ${signColor}`}>{currency.format(Math.abs(step.delta))}</TableCell>
                            <TableCell className={`text-xs text-right font-medium ${signColor}`}>{currency.format(step.runningBalance)}</TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      </TableCell>
    </TableRow>
  );
}
