import type { ProjectionResult } from "@/lib/projection";
import { currency, pct, formatDate } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRoute } from "@/lib/format";

interface TransactionCompletionTableProps {
  postingSummaries: ProjectionResult["postingSummaries"];
}

export function TransactionCompletionTable({ postingSummaries }: TransactionCompletionTableProps) {
  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Transaction completion</CardTitle>
          <CardDescription>Which scheduled transactions were fully applied and which were limited by available funds.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Completion</TableHead>
              <TableHead>First unfunded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {postingSummaries.length > 0 ? postingSummaries.map((summary) => {
              const hasShortfall = summary.utilizationRate < 1;

              return (
                <TableRow key={summary.postingId}>
                  <TableCell>
                    <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{summary.label}</span>
                  </TableCell>
                  <TableCell>
                    <span className={hasShortfall ? "text-amber-700" : undefined}>{formatRoute(summary.sourceAccountLabel, summary.destinations)}</span>
                  </TableCell>
                  <TableCell>{summary.priority}</TableCell>
                  <TableCell>{currency.format(summary.requestedAmount)}</TableCell>
                  <TableCell>
                    <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(summary.realizedAmount)}</span>
                  </TableCell>
                  <TableCell>
                    <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{pct.format(summary.utilizationRate)}</span>
                  </TableCell>
                  <TableCell>
                    <span className={hasShortfall ? "font-medium text-amber-700" : "text-slate-400"}>{hasShortfall ? formatDate(summary.firstShortfallDate!) : "-"}</span>
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-slate-500">No scheduled transactions are defined.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
