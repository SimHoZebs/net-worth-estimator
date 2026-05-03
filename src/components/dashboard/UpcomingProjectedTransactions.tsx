import { memo } from "react";
import type { ProjectionRow } from "@/lib/projection";
import { currency, formatDate } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface UpcomingProjectedTransactionsProps {
  rows: ProjectionRow[];
  expandedEventRows: Set<string>;
  onToggleEventRow: (date: string) => void;
  postingLabelById: Record<string, string>;
}

export const UpcomingProjectedTransactions = memo(function UpcomingProjectedTransactions({
  rows,
  expandedEventRows,
  onToggleEventRow,
  postingLabelById,
}: UpcomingProjectedTransactionsProps) {
  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Upcoming projected transactions</CardTitle>
          <CardDescription>The next projected dates and their requested vs applied scheduled activity.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Unfunded</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Net worth</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? rows.slice(0, 12).map((row: ProjectionRow) => {
              const isExpanded = expandedEventRows.has(row.date);
              const activePostingIds = Object.entries(row.requestedPostingAmountsById)
                .filter(([, amount]) => amount > 0)
                .map(([id]) => id);
              const hasShortfall = row.clampedPostingShortfallAmount > 0;

              return (
                <>
                  <TableRow
                    key={row.date}
                    className={`cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                    onClick={() => onToggleEventRow(row.date)}
                  >
                    <TableCell className="w-8 select-none text-slate-400">
                      {isExpanded ? "▾" : "▸"}
                    </TableCell>
                    <TableCell>
                      <span className={hasShortfall ? "font-medium text-amber-700" : undefined}>{formatDate(row.date)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(row.requestedPostingAmount)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={hasShortfall ? "text-amber-700" : undefined}>{currency.format(row.realizedPostingAmount)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={hasShortfall ? "font-semibold text-amber-700" : undefined}>{currency.format(row.clampedPostingShortfallAmount)}</span>
                    </TableCell>
                    <TableCell>
                      {hasShortfall ? <span className="text-xs text-slate-600">Limited by available funds</span> : <span className="text-xs text-slate-400">—</span>}
                    </TableCell>
                    <TableCell>{currency.format(row.netWorth)}</TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <TableRow key={`${row.date}-detail`}>
                      <TableCell colSpan={7} className="border-b-2 border-slate-100 bg-slate-50 p-0">
                        <div className="px-8 pb-2 pt-1">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-100">
                                <TableHead className="text-xs">Transaction</TableHead>
                                <TableHead className="text-xs">Requested</TableHead>
                                <TableHead className="text-xs">Applied</TableHead>
                                <TableHead className="text-xs">Unfunded</TableHead>
                                <TableHead className="text-xs">Reason</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {activePostingIds.map((id) => {
                                const requested = row.requestedPostingAmountsById[id] ?? 0;
                                const realized = row.realizedPostingAmountsById[id] ?? 0;
                                const shortfall = requested - realized;
                                const label = postingLabelById[id] ?? id;
                                const perShortfall = shortfall > 0;
                                return (
                                  <TableRow key={id} className="border-b-0">
                                    <TableCell className={perShortfall ? "font-medium text-amber-700" : undefined}>{label}</TableCell>
                                    <TableCell>{currency.format(requested)}</TableCell>
                                    <TableCell className={perShortfall ? "text-amber-700" : undefined}>{currency.format(realized)}</TableCell>
                                    <TableCell className={perShortfall ? "font-semibold text-amber-700" : undefined}>{currency.format(shortfall)}</TableCell>
                                    <TableCell className="text-xs text-slate-600">{perShortfall ? "Limited by available funds" : "—"}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-slate-500">No upcoming projected transactions are available.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
});
