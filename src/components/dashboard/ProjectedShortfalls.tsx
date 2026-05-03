import { memo, useCallback, useMemo, useState } from "react";
import type { Account, Posting, ProjectionRow } from "@/lib/projection";
import { currency } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShortfallMonthDetail } from "./ShortfallMonthDetail";

interface ProjectedShortfallsProps {
  rows: ProjectionRow[];
  postings: Posting[];
  accounts: Account[];
}

export const ProjectedShortfalls = memo(function ProjectedShortfalls({
  rows,
  postings,
  accounts,
}: ProjectedShortfallsProps) {
  const [expandedEventRows, setExpandedEventRows] = useState<Set<string>>(new Set());

  const toggleEventRow = useCallback((monthKey: string) => {
    setExpandedEventRows(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }, []);

  const postingById = useMemo(() => {
    const map: Record<string, Posting> = {};
    for (const p of postings) map[p.id] = p;
    return map;
  }, [postings]);

  const postingLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of postings) map[p.id] = p.label;
    return map;
  }, [postings]);

  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) map[a.id] = a.label;
    return map;
  }, [accounts]);

  const shortfallMonths = useMemo(() => {
    const hasShortfallInMonth = new Set<string>();
    for (const row of rows) {
      if (row.clampedPostingShortfallAmount > 0) {
        hasShortfallInMonth.add(row.date.slice(0, 7));
      }
    }
    const data = new Map<string, { requestedPostingAmount: number; realizedPostingAmount: number; clampedPostingShortfallAmount: number; netWorth: number }>();
    for (const row of rows) {
      const monthKey = row.date.slice(0, 7);
      if (!hasShortfallInMonth.has(monthKey)) continue;
      const existing = data.get(monthKey);
      if (existing) {
        existing.requestedPostingAmount += row.requestedPostingAmount;
        existing.realizedPostingAmount += row.realizedPostingAmount;
        existing.clampedPostingShortfallAmount += row.clampedPostingShortfallAmount;
        existing.netWorth = row.netWorth;
      } else {
        data.set(monthKey, {
          requestedPostingAmount: row.requestedPostingAmount,
          realizedPostingAmount: row.realizedPostingAmount,
          clampedPostingShortfallAmount: row.clampedPostingShortfallAmount,
          netWorth: row.netWorth,
        });
      }
    }
    return Array.from(data.entries()).map(([monthKey, d]) => ({
      monthKey,
      label: new Date(monthKey + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      ...d,
    })).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [rows]);

  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Projected shortfalls</CardTitle>
          <CardDescription>Upcoming dates where scheduled transactions cannot be fully funded.</CardDescription>
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
            {shortfallMonths.length > 0 ? shortfallMonths.slice(0, 12).map((row) => {
              const isExpanded = expandedEventRows.has(row.monthKey);
              const hasShortfall = row.clampedPostingShortfallAmount > 0;

              return (
                <>
                  <TableRow
                    className={`cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                    onClick={() => toggleEventRow(row.monthKey)}
                  >
                    <TableCell className="w-8 select-none text-slate-400">
                      {isExpanded ? "▾" : "▸"}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-amber-700">{row.label}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-amber-700">{currency.format(row.requestedPostingAmount)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-amber-700">{currency.format(row.realizedPostingAmount)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-amber-700">{currency.format(row.clampedPostingShortfallAmount)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-600">Limited by available funds</span>
                    </TableCell>
                    <TableCell>{currency.format(row.netWorth)}</TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <ShortfallMonthDetail
                      key={`${row.monthKey}-detail`}
                      monthKey={row.monthKey}
                      monthLabel={row.label}
                      monthRows={rows.filter(r => r.date.slice(0, 7) === row.monthKey)}
                      rows={rows}
                      postingById={postingById}
                      postingLabelById={postingLabelById}
                      accounts={accounts}
                    />
                  ) : null}
                </>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-slate-500">No projected shortfalls are scheduled.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
});
