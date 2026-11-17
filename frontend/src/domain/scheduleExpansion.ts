import { isIsoDate, shiftDate } from "./format.ts";

/**
 * Scheduled occurrence dates of a schedule from its start date
 * through `through` (inclusive), never past the schedule's own end date.
 * An open-ended schedule stops at `through`.
 * Projection-only helper: the claim UI reads occurrences from the server
 * endpoint instead of expanding dates locally.
 */
export function scheduleOccurrenceDates({
	startDate,
	endDate,
	frequency,
	through,
}: {
	startDate: string;
	endDate: string | null;
	frequency: string;
	through: string;
}): string[] {
	const effectiveEnd =
		endDate !== null && endDate < through ? endDate : through;
	if (!isIsoDate(startDate) || startDate > effectiveEnd) return [];
	const dates: string[] = [];
	for (let count = 0; ; count += 1) {
		const date = advanceOccurrence(startDate, frequency, count);
		if (date === null || date > effectiveEnd) return dates;
		dates.push(date);
	}
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamped calendar-month addition, mirroring the backend schedule math. */
function addMonthsClamped(startDate: string, months: number): string {
	const [year, month, day] = startDate.split("-").map(Number);
	const total = year! * 12 + (month! - 1) + months;
	const nextYear = Math.floor(total / 12);
	const nextMonth = (total % 12) + 1;
	const nextDay = Math.min(day!, daysInMonth(nextYear, nextMonth));
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`;
}

function advanceOccurrence(
	startDate: string,
	frequency: string,
	count: number,
): string | null {
	switch (frequency) {
		case "daily":
			return addDays(startDate, count);
		case "weekly":
			return addDays(startDate, count * 7);
		case "monthly":
			return addMonthsClamped(startDate, count);
		case "quarterly":
			return addMonthsClamped(startDate, count * 3);
		case "annual":
			return addMonthsClamped(startDate, count * 12);
		default:
			return null;
	}
}

function addDays(date: string, days: number): string {
	return shiftDate({ date, days });
}
