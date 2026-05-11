import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, formatDate } from "@/lib/format";
import type { ScenarioPack, ProjectionResult } from "@/lib/projection";

interface NetWorthReconciliationProps {
  pack: ScenarioPack;
  result: ProjectionResult;
}

export const NetWorthReconciliation = memo(function NetWorthReconciliation({ pack, result }: NetWorthReconciliationProps) {
  const latestDate = result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate;

  // Group checkpoints by account, take the latest one per account
  const accountMap = new Map<string, { label: string; balance: number; checkpointDate: string }>();
  for (const cp of pack.checkpoints) {
    const account = pack.accounts.find((a) => a.id === cp.AccountId);
    const existing = accountMap.get(cp.AccountId);
    if (!existing || cp.Date > existing.checkpointDate) {
      accountMap.set(cp.AccountId, {
        label: account?.label ?? cp.AccountId,
        balance: cp.Balance,
        checkpointDate: cp.Date,
      });
    }
  }

  const rows = Array.from(accountMap.entries()).map(([accountId, data]) => ({
    accountId,
    ...data,
    isLatest: data.checkpointDate === latestDate,
  }));

  const assets = rows.filter((r) => r.balance >= 0);
  const liabilities = rows.filter((r) => r.balance < 0);

  return (
    <Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardHeader>
        <div>
          <CardTitle>Current net worth reconciliation</CardTitle>
          <CardDescription>Which balances were used to compute the current net worth of {currency.format(result.summary.currentNetWorth)}.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Assets</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>As of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.length > 0 ? assets.map((r) => (
                  <TableRow key={r.accountId}>
                    <TableCell className="text-sm text-slate-700 dark:text-slate-300">{r.label}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-slate-900 dark:text-slate-100">{currency.format(r.balance)}</TableCell>
                    <TableCell className="text-sm text-slate-500 dark:text-slate-400">{formatDate(r.checkpointDate)}{r.isLatest ? " · latest" : ""}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">No asset checkpoints.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Liabilities</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>As of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liabilities.length > 0 ? liabilities.map((r) => (
                  <TableRow key={r.accountId}>
                    <TableCell className="text-sm text-slate-700 dark:text-slate-300">{r.label}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-slate-900 dark:text-slate-100">{currency.format(r.balance)}</TableCell>
                    <TableCell className="text-sm text-slate-500 dark:text-slate-400">{formatDate(r.checkpointDate)}{r.isLatest ? " · latest" : ""}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">No liability checkpoints.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-900 dark:text-slate-100">Net worth</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{currency.format(result.summary.currentNetWorth)}</span>
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">Computed from the latest checkpoint per account.</div>
        </div>
      </CardContent>
    </Card>
  );
});
