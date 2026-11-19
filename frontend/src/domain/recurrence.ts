import { isIsoDate, shiftDate, utcDate } from "./format.ts";

/**
 * Google Calendar-lite recurrence. A schedule repeats every `interval`
 * `unit`s anchored on its start date, and ends never (endDate null) or on
 * a date. There is no occurrence count. This replaces the legacy schedule
 * `frequency` vocabulary (daily/weekly/monthly/quarterly/annual).
 */
export type RecurrenceUnit = "day" | "week" | "month" | "year";

/** Monthly anchor: calendar date, or the nth weekday of the month. */
export type MonthlyMode = "byDate" | "byNthWeekday";

export interface Recurrence {
	unit: RecurrenceUnit;
	/** Repeat step, 1..99. */
	interval: number;
	/** Weekly only: 0=Sun..6=Sat. Must include the start-date weekday. */
	weekdays?: number[];
	/** Monthly only: calendar-date anchor or nth-weekday anchor. */
	monthlyMode?: MonthlyMode;
}

export const RECURRENCE_UNITS: readonly RecurrenceUnit[] = [
	"day",
	"week",
	"month",
	"year",
];

/** Weekday toggle labels, 0=Sun..6=Sat. */
export const WEEKDAY_TOGGLE_LABELS = [
	"S",
	"M",
	"T",
	"W",
	"T",
	"F",
	"S",
] as const;

const WEEKDAY_FULL_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

const WEEKDAY_SHORT_NAMES = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
] as const;

const MONTH_SHORT_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const NTH_PHRASES = ["first", "second", "third", "fourth", "fifth"] as const;

/** Weekday of an ISO date, 0=Sun..6=Sat. NaN when the date is not valid. */
export function weekdayOfIsoDate(iso: string): number {
	return utcDate(iso).getUTCDay();
}

/** Day of month of an ISO date. NaN when the date is not valid. */
export function dayOfMonthOfIsoDate(iso: string): number {
	return utcDate(iso).getUTCDate();
}

/** English ordinal: 1st, 2nd, 3rd, 4th, 11th, 15th, 23rd. */
export function ordinal(day: number): string {
	const teen = day % 100;
	if (teen >= 11 && teen <= 13) return `${day}th`;
	switch (day % 10) {
		case 1:
			return `${day}st`;
		case 2:
			return `${day}nd`;
		case 3:
			return `${day}rd`;
		default:
			return `${day}th`;
	}
}

export interface MonthAnchor {
	weekday: number;
	/** 1-based occurrence of the weekday within the month. */
	nth: number;
	/** True when the start date is the last such weekday of its month. */
	isLast: boolean;
}

/** Nth-weekday anchor derived from a start date, e.g. third Tuesday. */
export function monthAnchorOfStartDate(startDate: string): MonthAnchor {
	const date = utcDate(startDate);
	const weekday = date.getUTCDay();
	const nth = Math.ceil(date.getUTCDate() / 7);
	const later = new Date(date.getTime());
	later.setUTCDate(later.getUTCDate() + 7);
	return {
		weekday,
		nth,
		isLast: later.getUTCMonth() !== date.getUTCMonth(),
	};
}

function nthPhrase(nth: number, isLast: boolean): string {
	if (isLast) return "last";
	return NTH_PHRASES[nth - 1] ?? `${nth}th`;
}

function validInterval(interval: unknown): number | null {
	return typeof interval === "number" &&
		Number.isInteger(interval) &&
		interval >= 1 &&
		interval <= 99
		? interval
		: null;
}

function sortedWeekdays(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	const days = value.filter(
		(day): day is number =>
			typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
	);
	return [...new Set(days)].sort((left, right) => left - right);
}

/**
 * Human sentence for a recurrence anchored on a start date, e.g.
 * "Every day", "Every 2 weeks on Tue, Thu", "Monthly on the third Tuesday".
 */
export function recurrenceSentence(
	recurrence: Recurrence,
	startDate: string,
): string {
	const interval = validInterval(recurrence.interval) ?? 1;
	const start = isIsoDate(startDate) ? utcDate(startDate) : null;
	const startWeekday = start ? start.getUTCDay() : 1;
	switch (recurrence.unit) {
		case "day":
			return interval === 1 ? "Every day" : `Every ${interval} days`;
		case "week": {
			const days = sortedWeekdays(recurrence.weekdays);
			if (days.length === 0) days.push(startWeekday);
			const dayPart =
				days.length === 1
					? WEEKDAY_FULL_NAMES[days[0] as number]
					: days.map((day) => WEEKDAY_SHORT_NAMES[day as number]).join(", ");
			const unitPart = interval === 1 ? "week" : `${interval} weeks`;
			return `Every ${unitPart} on ${dayPart}`;
		}
		case "month": {
			if (recurrence.monthlyMode === "byNthWeekday" && start) {
				const anchor = monthAnchorOfStartDate(startDate);
				const phrase = nthPhrase(anchor.nth, anchor.isLast);
				const weekday = WEEKDAY_FULL_NAMES[anchor.weekday];
				return interval === 1
					? `Monthly on the ${phrase} ${weekday}`
					: `Every ${interval} months on the ${phrase} ${weekday}`;
			}
			const day = start ? start.getUTCDate() : 1;
			const unitPart = interval === 1 ? "month" : `${interval} months`;
			return `Every ${unitPart} on the ${ordinal(day)}`;
		}
		case "year": {
			const month = start ? MONTH_SHORT_NAMES[start.getUTCMonth()] : "Jan";
			const day = start ? start.getUTCDate() : 1;
			const unitPart = interval === 1 ? "year" : `${interval} years`;
			return `Every ${unitPart} on ${month} ${day}`;
		}
	}
}

/** Client-side validation mirroring the backend recurrence rules. */
export function validateRecurrence(
	recurrence: Recurrence,
	startDate: string,
): string | null {
	if (!recurrence || !RECURRENCE_UNITS.includes(recurrence.unit))
		return "Choose how often the schedule repeats.";
	if (validInterval(recurrence.interval) === null)
		return "Enter a repeat interval from 1 to 99.";
	if (recurrence.unit === "week") {
		const days = sortedWeekdays(recurrence.weekdays);
		if (days.length === 0) return "Choose at least one weekday.";
		if (isIsoDate(startDate) && !days.includes(weekdayOfIsoDate(startDate)))
			return "The repeat days must include the first occurrence weekday.";
	} else if (recurrence.weekdays && recurrence.weekdays.length > 0) {
		return "Weekdays only apply to weekly schedules.";
	}
	if (
		recurrence.unit === "month" &&
		recurrence.monthlyMode !== "byDate" &&
		recurrence.monthlyMode !== "byNthWeekday"
	)
		return "Choose how the monthly schedule anchors.";
	if (recurrence.unit !== "month" && recurrence.monthlyMode !== undefined)
		return "The monthly anchor only applies to monthly schedules.";
	return null;
}

/** Equality for recurrence payloads: sorted weekdays, default monthly mode. */
export function recurrenceEqual(left: Recurrence, right: Recurrence): boolean {
	if (left.unit !== right.unit || left.interval !== right.interval)
		return false;
	if (left.unit === "week") {
		const leftDays = sortedWeekdays(left.weekdays);
		const rightDays = sortedWeekdays(right.weekdays);
		return (
			leftDays.length === rightDays.length &&
			leftDays.every((day, index) => day === rightDays[index])
		);
	}
	if (left.unit === "month")
		return (left.monthlyMode ?? "byDate") === (right.monthlyMode ?? "byDate");
	return true;
}

/**
 * Legacy schedule frequency mapped to the new recurrence vocabulary:
 * daily to every day, weekly to every week on the start weekday, monthly
 * to every month on the date, quarterly to every 3 months on the date,
 * annual to every year.
 */
export function recurrenceFromFrequency(
	frequency: unknown,
	startDate: string,
): Recurrence {
	const startWeekday = isIsoDate(startDate) ? weekdayOfIsoDate(startDate) : 1;
	switch (frequency) {
		case "daily":
			return { unit: "day", interval: 1 };
		case "weekly":
			return { unit: "week", interval: 1, weekdays: [startWeekday] };
		case "biweekly":
			return { unit: "week", interval: 2, weekdays: [startWeekday] };
		case "quarterly":
			return { unit: "month", interval: 3, monthlyMode: "byDate" };
		case "annual":
		case "yearly":
			return { unit: "year", interval: 1 };
		case "monthly":
		default:
			return { unit: "month", interval: 1, monthlyMode: "byDate" };
	}
}

function coerceRecurrence(
	value: unknown,
	startDate: string,
): Recurrence | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.unit !== "string" ||
		!(RECURRENCE_UNITS as readonly string[]).includes(record.unit)
	)
		return null;
	const unit = record.unit as RecurrenceUnit;
	const recurrence: Recurrence = {
		unit,
		interval: validInterval(record.interval) ?? 1,
	};
	if (unit === "week") {
		const days = sortedWeekdays(record.weekdays);
		recurrence.weekdays = days.length
			? days
			: [isIsoDate(startDate) ? weekdayOfIsoDate(startDate) : 1];
	}
	if (unit === "month")
		recurrence.monthlyMode =
			record.monthlyMode === "byNthWeekday" ? "byNthWeekday" : "byDate";
	return recurrence;
}

/**
 * Stored schedule cadence during the frequency-to-recurrence migration:
 * prefers an explicit recurrence payload, otherwise maps the legacy
 * frequency string. Null when the schedule carries neither.
 */
export function recurrenceFromScheduleLike(
	schedule:
		| {
				recurrence?: unknown;
				frequency?: unknown;
				startDate: string;
		  }
		| null
		| undefined,
): Recurrence | null {
	if (!schedule || typeof schedule.startDate !== "string") return null;
	return (
		coerceRecurrence(schedule.recurrence, schedule.startDate) ??
		(typeof schedule.frequency === "string"
			? recurrenceFromFrequency(schedule.frequency, schedule.startDate)
			: null)
	);
}

/**
 * Weekly anchor maintenance: the repeat days must include the start-date
 * weekday. Call when the start date moves; keeps the other chosen days.
 */
export function ensureStartWeekday(
	recurrence: Recurrence,
	startDate: string,
): Recurrence {
	if (recurrence.unit !== "week" || !isIsoDate(startDate)) return recurrence;
	const startWeekday = weekdayOfIsoDate(startDate);
	const days = sortedWeekdays(recurrence.weekdays);
	if (days.includes(startWeekday)) return recurrence;
	return { ...recurrence, weekdays: [...days, startWeekday].sort() };
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamped calendar-month addition, mirroring the backend schedule math. */
export function addMonthsClamped(startDate: string, months: number): string {
	const [year, month, day] = startDate.split("-").map(Number);
	const total = year! * 12 + (month! - 1) + months;
	const nextYear = Math.floor(total / 12);
	const nextMonth = (total % 12) + 1;
	const nextDay = Math.min(day!, daysInMonth(nextYear, nextMonth));
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`;
}

/**
 * Date of the nth weekday of a calendar month (month 1..12), or the last
 * such weekday when `last` is set. Null when the month has no such date,
 * e.g. a non-last fifth Monday.
 */
export function monthlyNthWeekdayDate({
	year,
	month,
	weekday,
	nth,
	last,
}: {
	year: number;
	month: number;
	weekday: number;
	nth: number;
	last: boolean;
}): string | null {
	const days: string[] = [];
	const pad = (value: number) => String(value).padStart(2, "0");
	for (let day = 1; day <= daysInMonth(year, month); day += 1) {
		if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === weekday)
			days.push(`${year}-${pad(month)}-${pad(day)}`);
	}
	if (!days.length) return null;
	if (last) return days[days.length - 1] ?? null;
	return days[nth - 1] ?? null;
}

/**
 * Local preview expansion mirroring the backend schedule math:
 * day adds k*interval days; week keeps dates on the chosen weekdays whose
 * week index since the start is a multiple of the interval; month byDate
 * adds k*interval clamped months; month byNthWeekday repeats the start
 * date's nth weekday (or last), skipping months without a non-last fifth
 * occurrence; year adds k*interval*12 clamped months.
 */
export function recurrenceOccurrenceDates({
	startDate,
	recurrence,
	endDate,
	through,
}: {
	startDate: string;
	recurrence: Recurrence;
	endDate: string | null;
	through: string;
}): string[] {
	if (!isIsoDate(startDate)) return [];
	const effectiveEnd =
		endDate !== null && endDate < through ? endDate : through;
	if (startDate > effectiveEnd) return [];
	const interval = validInterval(recurrence.interval) ?? 1;
	switch (recurrence.unit) {
		case "day": {
			const dates: string[] = [];
			for (let count = 0; count < 100000; count += 1) {
				const date = shiftDate({ date: startDate, days: count * interval });
				if (date > effectiveEnd) return dates;
				dates.push(date);
			}
			return dates;
		}
		case "week": {
			const days = new Set(sortedWeekdays(recurrence.weekdays));
			if (!days.size) return [];
			const startMs = utcDate(startDate).getTime();
			const endMs = utcDate(effectiveEnd).getTime();
			const dates: string[] = [];
			for (
				let offset = 0;
				startMs + offset * 86_400_000 <= endMs && offset <= 36_500;
				offset += 1
			) {
				const candidate = shiftDate({ date: startDate, days: offset });
				if (!days.has(utcDate(candidate).getUTCDay())) continue;
				if (Math.floor(offset / 7) % interval !== 0) continue;
				dates.push(candidate);
			}
			return dates;
		}
		case "month": {
			if (recurrence.monthlyMode === "byNthWeekday") {
				const anchor = monthAnchorOfStartDate(startDate);
				const [startYear, startMonth] = startDate.split("-").map(Number);
				const dates: string[] = [];
				for (let count = 0; count < 1200; count += 1) {
					const total = startYear! * 12 + (startMonth! - 1) + count * interval;
					const year = Math.floor(total / 12);
					const month = (total % 12) + 1;
					const date = monthlyNthWeekdayDate({
						year,
						month,
						weekday: anchor.weekday,
						nth: anchor.nth,
						last: anchor.isLast,
					});
					if (date === null) continue;
					if (date < startDate) continue;
					if (date > effectiveEnd) return dates;
					dates.push(date);
				}
				return dates;
			}
			const dates: string[] = [];
			for (let count = 0; count < 1200; count += 1) {
				const date = addMonthsClamped(startDate, count * interval);
				if (date > effectiveEnd) return dates;
				dates.push(date);
			}
			return dates;
		}
		case "year": {
			const dates: string[] = [];
			for (let count = 0; count < 1200; count += 1) {
				const date = addMonthsClamped(startDate, count * interval * 12);
				if (date > effectiveEnd) return dates;
				dates.push(date);
			}
			return dates;
		}
	}
}

/**
 * First `count` occurrence dates for live previews. Extends the horizon
 * until enough dates land or a sixty-year cap stops the search.
 */
export function previewNextOccurrences({
	startDate,
	recurrence,
	endDate,
	count,
}: {
	startDate: string;
	recurrence: Recurrence;
	endDate: string | null;
	count: number;
}): string[] {
	if (!isIsoDate(startDate) || count <= 0) return [];
	let horizonDays = 730;
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const dates = recurrenceOccurrenceDates({
			startDate,
			recurrence,
			endDate,
			through: shiftDate({ date: startDate, days: horizonDays }),
		});
		if (dates.length >= count || horizonDays >= 21_900)
			return dates.slice(0, count);
		horizonDays *= 2;
	}
	return [];
}
