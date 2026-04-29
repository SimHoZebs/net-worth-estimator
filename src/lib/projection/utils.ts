import type { EventType, ProjectionEvent } from "./types";

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

interface EventInput {
  month: number | null;
  type: EventType;
  amount: number;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
}

export function createEvent({ month, type, amount, source, destination, taxTreatment, meta = {} }: EventInput): ProjectionEvent {
  return {
    month,
    type,
    amount: Math.max(0, amount || 0),
    source,
    destination,
    taxTreatment,
    meta,
  };
}

export function sumEvents(events: ProjectionEvent[], predicate: (event: ProjectionEvent) => boolean): number {
  return events.reduce((sum, event) => (predicate(event) ? sum + event.amount : sum), 0);
}
