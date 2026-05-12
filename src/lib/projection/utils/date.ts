import type { IsoDate } from "../types/scenario";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseIsoDate(value: IsoDate): Date {
	return new Date(`${value}T00:00:00Z`);
}

export function formatIsoDate(date: Date): IsoDate {
	return date.toISOString().slice(0, 10);
}

export function getDaysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareIsoDates(left: IsoDate, right: IsoDate): number {
	return parseIsoDate(left).getTime() - parseIsoDate(right).getTime();
}

export function daysBetween(left: IsoDate, right: IsoDate): number {
	return Math.round(
		(parseIsoDate(right).getTime() - parseIsoDate(left).getTime()) / MS_PER_DAY,
	);
}

export function addMonthsClamped(date: IsoDate, monthsToAdd: number): IsoDate {
	const source = parseIsoDate(date);
	const year = source.getUTCFullYear();
	const month = source.getUTCMonth();
	const day = source.getUTCDate();
	const nextMonthIndex = month + monthsToAdd;
	const targetYear = year + Math.floor(nextMonthIndex / 12);
	const targetMonth = ((nextMonthIndex % 12) + 12) % 12;
	const targetDay = Math.min(day, getDaysInMonth(targetYear, targetMonth + 1));

	return formatIsoDate(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
}

export function addYearsClamped(date: IsoDate, yearsToAdd: number): IsoDate {
	return addMonthsClamped(date, yearsToAdd * 12);
}
