export function clampNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function monthLabel(monthsFromNow: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsFromNow);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function yearLabel(monthsFromNow: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsFromNow);
  return String(date.getFullYear());
}

export function getYearIndex(month: number): number {
  return Math.floor(month / 12);
}

export function getProjectionLastMonth(maxYears: number): number {
  return Math.max(0, Math.floor(maxYears * 12) - 1);
}
