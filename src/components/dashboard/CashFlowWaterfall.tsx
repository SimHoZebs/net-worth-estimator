import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, formatFrequency } from "@/lib/format";
import type { ScenarioPack, Posting } from "@/lib/projection";
import { isNumericArithmetic, parseNumericArithmetic, categorizePosting } from "@/lib/posting-categories";

interface CashFlowWaterfallProps {
  pack: ScenarioPack;
}

export const CashFlowWaterfall = memo(function CashFlowWaterfall({ pack }: CashFlowWaterfallProps) {
  const enabledPostings = pack.postings.filter((p) => p.enabled);

  const items = enabledPostings.map((p) => {
    const { type, category } = categorizePosting(p);
    const isNumeric = isNumericArithmetic(p.arithmetic);
    const amount = isNumeric ? parseNumericArithmetic(p.arithmetic) : null;
    const sign = type === "income" ? 1 : -1;
    const signedAmount = amount !== null ? amount * sign : null;

    return {
      label: p.label,
      category,
      type,
      arithmetic: p.arithmetic,
      frequency: p.frequency,
      amount: signedAmount,
      isNumeric,
    };
  });

  const numericItems = items.filter((i) => i.isNumeric);
  const totalInflow = numericItems.filter((i) => i.type === "income").reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const totalOutflow = numericItems.filter((i) => i.type !== "income").reduce((sum, i) => sum + Math.abs(i.amount ?? 0), 0);
  const remaining = totalInflow - totalOutflow;

  return (
    <Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardHeader>
        <div>
          <CardTitle>Monthly cash flow</CardTitle>
          <CardDescription>How money moves through the model each month.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Transaction</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Frequency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              <>
                {items.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{item.category}</TableCell>
                    <TableCell className="text-sm text-slate-700 dark:text-slate-300">{item.label}</TableCell>
                    <TableCell className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {item.isNumeric ? currency.format(item.amount ?? 0) : item.arithmetic}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500 dark:text-slate-400">{formatFrequency(item.frequency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200 dark:border-slate-700">
                  <TableCell colSpan={2} className="text-sm font-semibold text-slate-900 dark:text-slate-100">Remaining cash / investment capacity</TableCell>
                  <TableCell className="text-sm font-semibold text-slate-900 dark:text-slate-100">{currency.format(remaining)}</TableCell>
                  <TableCell />
                </TableRow>
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-slate-500 dark:text-slate-400">No scheduled transactions are enabled.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {numericItems.length < items.length ? (
          <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Some transactions use formulas rather than fixed amounts. Exact monthly totals depend on account balances and other dynamic values.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});
