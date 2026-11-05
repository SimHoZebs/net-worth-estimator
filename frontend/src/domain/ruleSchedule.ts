import { isIsoDate } from "./format.ts";

/**
 * Scheduled occurrence dates of a schedule from its start date
 * through `through` (inclusive), never past the schedule's own end date.
 * The window to today is the claimable range: a posting exists in the
 * past or today, so only occurrences scheduled by then are offered.
 * An open-ended schedule stops at `through`.
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

/**
 * Claim candidates for one schedule, ordered by absolute distance to the day
 * the posting actually happened; ties keep chronological order. Dates
 * another row already claimed for this schedule are excluded.
 */
export function claimOccurrenceCandidates({
	schedule,
	through,
	postedRef,
	claimed,
}: {
	schedule: { startDate: string; endDate: string | null; frequency: string };
	through: string;
	postedRef: string;
	claimed: ReadonlySet<string>;
}): string[] {
	const anchor = Date.parse(`${postedRef}T00:00:00Z`);
	return scheduleOccurrenceDates({ ...schedule, through })
		.filter((date) => !claimed.has(date))
		.sort((a, b) => {
			const distance =
				Math.abs(Date.parse(`${a}T00:00:00Z`) - anchor) -
				Math.abs(Date.parse(`${b}T00:00:00Z`) - anchor);
			if (distance !== 0) return distance;
			return a < b ? -1 : a > b ? 1 : 0;
		});
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
	const stamp = Date.parse(`${date}T00:00:00Z`);
	return new Date(stamp + days * 86400000).toISOString().slice(0, 10);
}
