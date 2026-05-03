import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, formatDate } from "@/lib/format";
import type { ScenarioPack, ProjectionResult, Posting } from "@/lib/projection";

interface DebtSummaryProps {
  pack: ScenarioPack;
  result: ProjectionResult;
}

function findPaymentPosting(pack: ScenarioPack, accountId: string): Posting | undefined {
  return pack.postings.find((p) =>
    p.enabled &&
    p.destinations?.includes(accountId) &&
    (p.label.toLowerCase().includes("payment") || p.label.toLowerCase().includes("pay"))
  );
}

function isDebtAccount(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("loan") || l.includes("debt") || l.includes("mortgage") || l.includes("credit");
}

export function DebtSummary({ pack, result }: DebtSummaryProps) {
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
      <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <div className="text-sm text-slate-500">No debt accounts are currently tracked.</div>
        </CardContent>
      </Card>
    );
  }

  const totalDebt = allDebts.reduce((sum, d) => sum + Math.abs(d.balance), 0);

  function estimateMonthlyPayment(p: Posting | undefined): number {
    if (!p) return 0;
    const num = Number(p.arithmetic);
    if (!Number.isFinite(num)) return 0;
    const freq = p.frequency;
    if (freq === "monthly") return num;
    if (freq === "weekly") return num * 4.33;
    if (freq === "quarterly") return num / 3;
    if (freq === "annual") return num / 12;
    return num;
  }

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
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {allDebts.map((d) => (
              <TableRow key={d.account.id}>
                <TableCell className="text-sm text-slate-700">{d.account.label}</TableCell>
                <TableCell className="text-right text-sm font-medium text-slate-900">{currency.format(d.balance)}</TableCell>
                <TableCell className="text-right text-sm text-slate-700">
                  {d.paymentPosting ? d.paymentPosting.arithmetic : "—"}
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {d.paymentPosting ? d.paymentPosting.frequency : "—"}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-slate-200">
              <TableCell className="text-sm font-semibold text-slate-900">Total debt</TableCell>
              <TableCell className="text-right text-sm font-semibold text-slate-900">{currency.format(-totalDebt)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
        {estimatedTotalInterest > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <div className="text-xs font-medium text-amber-800">Estimated interest over loan life</div>
            <div className="mt-0.5 text-lg font-semibold text-amber-900">{currency.format(estimatedTotalInterest)}</div>
            <div className="text-xs text-amber-700">Rough estimate based on current balance and payment schedule.</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
