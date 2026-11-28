import { isRecord, parseUnion } from "./guards.ts";
import { isIsoDate, utcDate } from "./format.ts";

/**
 * Google Calendar-lite recurrence. A schedule repeats every `interval`
 * `unit`s anchored on its start date, and ends never (endDate null) or on
 * a date. There is no occurrence count.
 */
export type RecurrenceUnit = "day" | "week" | "month" | "year";

/** Monthly anchor: calendar date, or the nth weekday of the month. */
export type MonthlyMode = "byDate" | "byNthWeekday";

export interface Recurrence {
	unit: RecurrenceUnit;
	/** Repeat step, 1..99. */
	interval: number;
	/** Weekly only: 0=Sun..6=Sat. Must include the start-date weekday. */
	weekdays?: number[] | null;
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

function validWeekdays(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.every(
			(day) =>
				typeof day === "number" &&
				Number.isInteger(day) &&
				day >= 0 &&
				day <= 6,
		) &&
		new Set(value).size === value.length
	);
}

/** Read the current schedule recurrence without supplying missing values. */
export function recurrenceFromScheduleLike(
	schedule:
		| {
				recurrence?: unknown;
				startDate: string;
		  }
		| null
		| undefined,
): Recurrence | null {
	if (
		!schedule ||
		typeof schedule.startDate !== "string" ||
		!isIsoDate(schedule.startDate) ||
		!isRecord(schedule.recurrence)
	)
		return null;
	const value = schedule.recurrence;
	const unit = parseUnion(value.unit, RECURRENCE_UNITS);
	const interval = validInterval(value.interval);
	if (unit === null || interval === null) return null;
	if (
		value.weekdays !== undefined &&
		value.weekdays !== null &&
		!validWeekdays(value.weekdays)
	)
		return null;
	if (
		value.monthlyMode !== undefined &&
		value.monthlyMode !== "byDate" &&
		value.monthlyMode !== "byNthWeekday"
	)
		return null;
	const recurrence: Recurrence = {
		unit,
		interval,
		...(value.weekdays === undefined
			? {}
			: { weekdays: value.weekdays as number[] | null }),
		...(value.monthlyMode === undefined
			? {}
			: { monthlyMode: value.monthlyMode }),
	};
	return validateRecurrence(recurrence, schedule.startDate) === null
		? recurrence
		: null;
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
