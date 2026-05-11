import { memo, useMemo, useState } from "react";
import type { Account, Posting, ProjectionRow } from "@/lib/projection";
import { currency, formatDate } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { ShortfallDetailPanel } from "./ShortfallDetailPanel";

interface ShortfallCalendarProps {
  rows: ProjectionRow[];
  postings: Posting[];
  accounts: Account[];
}

interface ShortfallDay {
  date: string;
  label: string;
  requestedPostingAmount: number;
  realizedPostingAmount: number;
  clampedPostingShortfallAmount: number;
  netWorth: number;
}

function parseIsoDateLocal(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const ShortfallCalendar = memo(function ShortfallCalendar({
  rows,
  postings,
  accounts,
}: ShortfallCalendarProps) {
  const [selectedDateIso, setSelectedDateIso] = useState<string | null>(null);

  const postingById = useMemo(() => {
    const map: Record<string, Posting> = {};
    for (const posting of postings) map[posting.id] = posting;
    return map;
  }, [postings]);

  const postingLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const posting of postings) map[posting.id] = posting.label;
    return map;
  }, [postings]);

  const shortfallDays = useMemo(() => {
    const data = new Map<string, Omit<ShortfallDay, "date" | "label">>();
    for (const row of rows) {
      if (row.isHistorical || row.clampedPostingShortfallAmount <= 0) continue;
      const existing = data.get(row.date);
      if (existing) {
        existing.requestedPostingAmount += row.requestedPostingAmount;
        existing.realizedPostingAmount += row.realizedPostingAmount;
        existing.clampedPostingShortfallAmount += row.clampedPostingShortfallAmount;
        existing.netWorth = row.netWorth;
      } else {
        data.set(row.date, {
          requestedPostingAmount: row.requestedPostingAmount,
          realizedPostingAmount: row.realizedPostingAmount,
          clampedPostingShortfallAmount: row.clampedPostingShortfallAmount,
          netWorth: row.netWorth,
        });
      }
    }

    return Array.from(data.entries()).map(([date, day]) => ({
      date,
      label: formatDate(date),
      ...day,
    })).sort((left, right) => left.date.localeCompare(right.date));
  }, [rows]);

  const shortfallDayByDate = useMemo(() => {
    const map = new Map<string, ShortfallDay>();
    for (const day of shortfallDays) map.set(day.date, day);
    return map;
  }, [shortfallDays]);

  const shortfallDates = useMemo(() => shortfallDays.map((day) => parseIsoDateLocal(day.date)), [shortfallDays]);
  const selectedDay = selectedDateIso
    ? shortfallDayByDate.get(selectedDateIso) ?? null
    : null;
  const selectedDateRows = selectedDay
    ? rows.filter((row) => !row.isHistorical && row.date === selectedDay.date)
    : [];
  const totalShortfall = shortfallDays.reduce((total, day) => total + day.clampedPostingShortfallAmount, 0);
  const firstShortfallDate = shortfallDays[0]?.date ? parseIsoDateLocal(shortfallDays[0].date) : undefined;
  const lastShortfallDate = shortfallDays[shortfallDays.length - 1]?.date
    ? parseIsoDateLocal(shortfallDays[shortfallDays.length - 1].date)
    : undefined;

  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Shortfall calendar</CardTitle>
          <CardDescription>Dates where scheduled transactions cannot be fully funded. Select a highlighted day for cash-flow detail.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {shortfallDays.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <Calendar
                mode="single"
                selected={selectedDay ? parseIsoDateLocal(selectedDay.date) : undefined}
                defaultMonth={firstShortfallDate}
                startMonth={firstShortfallDate}
                endMonth={lastShortfallDate}
                numberOfMonths={2}
                disabled={(date) => !shortfallDayByDate.has(formatIsoDateLocal(date))}
                modifiers={{ shortfall: shortfallDates }}
                modifiersClassNames={{
                  shortfall: "[&_button]:border [&_button]:border-amber-300 [&_button]:bg-amber-50 [&_button]:font-semibold [&_button]:text-amber-900 [&_button]:hover:bg-amber-100",
                }}
                onDayClick={(date, modifiers) => {
                  if (modifiers.disabled) return;
                  const isoDate = formatIsoDateLocal(date);
                  if (shortfallDayByDate.has(isoDate)) setSelectedDateIso(isoDate);
                }}
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-800">Shortfall dates</div>
                <div className="mt-1 text-2xl font-semibold text-amber-950">{currency.format(totalShortfall)}</div>
                <div className="text-xs text-amber-800">Total unfunded across {shortfallDays.length} date{shortfallDays.length === 1 ? "" : "s"}</div>
              </div>

              <div className="space-y-2">
                {shortfallDays.slice(0, 8).map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDateIso(day.date)}
                    className="w-full rounded-xl border border-white/80 bg-white px-3 py-2 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-amber-950">{day.label}</span>
                      <span className="text-xs font-semibold text-amber-800">{currency.format(day.clampedPostingShortfallAmount)}</span>
                    </div>
                    <div className="mt-1 text-xs text-amber-900/70">
                      Requested {currency.format(day.requestedPostingAmount)}; applied {currency.format(day.realizedPostingAmount)}
                    </div>
                  </button>
                ))}
              </div>

              {shortfallDays.length > 8 ? (
                <div className="text-xs text-amber-900/70">Showing the first 8 shortfall dates. Use the calendar for later dates.</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-6 text-sm text-emerald-900">
            No projected shortfalls are scheduled within the horizon.
          </div>
        )}
      </CardContent>

      {selectedDay ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Shortfall detail for ${selectedDay.label}`}
          onClick={() => setSelectedDateIso(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-[1.6rem] bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700">Projected shortfall</div>
                <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{selectedDay.label}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {currency.format(selectedDay.clampedPostingShortfallAmount)} unfunded on this date.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDateIso(null)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                Close
              </button>
            </div>

            <ShortfallDetailPanel
              periodStartDate={selectedDay.date}
              periodLabel={selectedDay.label}
              periodRows={selectedDateRows}
              rows={rows}
              postingById={postingById}
              postingLabelById={postingLabelById}
              accounts={accounts}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
});
