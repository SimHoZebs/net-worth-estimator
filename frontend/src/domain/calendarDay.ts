/**
 * Strict YYYY-MM-DD calendar day check shared by editors and snapshots.
 * `new Date` silently rolls impossible days (February 30 becomes March 2),
 * so values must round-trip exactly.
 */
export function calendarDayMs(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const ms = Date.UTC(year, month - 1, date);
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  )
    return null;
  return ms;
}

export function isCalendarDay(day: string): boolean {
  return calendarDayMs(day) !== null;
}
