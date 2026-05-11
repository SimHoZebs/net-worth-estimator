import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, formatDate } from "@/lib/format";
import type { ScenarioPack, ProjectionResult } from "@/lib/projection";
import { findPaymentPosting, isDebtAccount, estimateMonthlyPayment } from "@/lib/debt-utils";

interface DebtSummaryProps {
  pack: ScenarioPack;
  result: ProjectionResult;
}

export const DebtSummary = memo(function DebtSummary({ pack, result }: DebtSummaryProps) {
  const latestDate = result.milestones.latestHistoricalDate ?? result.milestones.projectionStartDate;

  // Get latest checkpoint per account
  const latestCheckpointByAccount = new Map<string, number>();
  for (const cp of pack.checkpoints) {
    const existing = latestCheckpointByAccount.get(cp.AccountId);
    if (existing === undefined || cp.Date > latestDate) {
      latestCheckpointByAccount.set(cp.AccountId, cp.Balance);
    }
  }

  const debtAccounts = pack.accounts
    .filter((a) => a.enabled && (latestCheckpointByAccount.get(a.id) ?? 0) < 0)
    .map((a) => ({
      account: a,
      balance: latestCheckpointByAccount.get(a.id) ?? 0,
      paymentPosting: findPaymentPosting(pack, a.id),
    }));

  // Also include accounts whose label suggests debt even if balance is 0
  const debtByLabel = pack.accounts
    .filter((a) => a.enabled && isDebtAccount(a.label) && !debtAccounts.some((d) => d.account.id === a.id))
    .map((a) => ({
      account: a,
      balance: latestCheckpointByAccount.get(a.id) ?? 0,
      paymentPosting: findPaymentPosting(pack, a.id),
    }));

  const allDebts = [...debtAccounts, ...debtByLabel];

  if (allDebts.length === 0) {
    return (
      <Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
        <CardContent className="p-5">
          <div className="text-sm text-slate-500 dark:text-slate-400">No debt accounts are currently tracked.</div>
        </CardContent>
      </Card>
    );
  }

  const totalDebt = allDebts.reduce((sum, d) => sum + Math.abs(d.balance), 0);

  const estimatedTotalInterest = allDebts.reduce((sum, d) => {
    const monthlyPmt = estimateMonthlyPayment(d.paymentPosting ?? undefined);
    if (monthlyPmt <= 0) return sum;
    const principal = Math.abs(d.balance);
    const totalAnnualPmt = monthlyPmt * 12;
    if (totalAnnualPmt <= 0) return sum;
    const approxYearsToPay = Math.min(principal / totalAnnualPmt, 30);
    const totalPayments = totalAnnualPmt * approxYearsToPay;
    return sum + Math.max(0, totalPayments - principal);
  }, 0);

  return (
    <Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardHeader>
        <div>
          <CardTitle>Debt summary</CardTitle>
          <CardDescription>Current debt balances, scheduled payments, and estimated interest.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Debt</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Payment</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead>Est. payoff</TableHead>
              <TableHead className="text-right">Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allDebts.map((d) => {
              const monthlyPmt = estimateMonthlyPayment(d.paymentPosting ?? undefined);
              const principal = Math.abs(d.balance);
              const monthsToPayoff = monthlyPmt > 0 ? Math.ceil(principal / monthlyPmt) : Infinity;
              const payoffDate = monthsToPayoff < 1200
                ? new Date(Date.now() + monthsToPayoff * 30 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10)
                : null;
              return (
                <TableRow key={d.account.id}>
                  <TableCell className="text-sm text-slate-700 dark:text-slate-300">{d.account.label}</TableCell>
                  <TableCell className="text-right text-sm font-medium text-slate-900 dark:text-slate-100">{currency.format(d.balance)}</TableCell>
                  <TableCell className="text-right text-sm text-slate-700 dark:text-slate-300">
                    {d.paymentPosting ? d.paymentPosting.arithmetic : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500 dark:text-slate-400">
                    {d.paymentPosting ? d.paymentPosting.frequency : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                    {payoffDate ? formatDate(payoffDate) : "Beyond 100 yr"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                    {d.paymentPosting?.priority ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2 border-slate-200 dark:border-slate-700">
              <TableCell className="text-sm font-semibold text-slate-900 dark:text-slate-100">Total debt</TableCell>
              <TableCell className="text-right text-sm font-semibold text-slate-900 dark:text-slate-100">{currency.format(-totalDebt)}</TableCell>
              <TableCell colSpan={4} />
            </TableRow>
          </TableBody>
        </Table>
        {estimatedTotalInterest > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-100 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3">
            <div className="text-xs font-medium text-amber-800 dark:text-amber-300">Estimated interest over loan life</div>
            <div className="mt-0.5 text-lg font-semibold text-amber-900 dark:text-amber-200">{currency.format(estimatedTotalInterest)}</div>
            <div className="text-xs text-amber-700 dark:text-amber-400">Rough estimate based on current balance and payment schedule.</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});
