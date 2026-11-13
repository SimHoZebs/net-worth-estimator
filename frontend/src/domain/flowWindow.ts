import { isoDate, utcDate } from "./format.ts";

export type FlowRangePresetId =
	| "this-month"
	| "last-month"
	| "last-3-months"
	| "year-to-date"
	| "last-12-months";

export interface FlowWindow {
	startDate: string;
	endDate: string;
}

function monthParts(todayIso: string): { year: number; month: number } {
	const date = utcDate(todayIso);
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function firstOfMonth(year: number, month: number): string {
	return isoDate(new Date(Date.UTC(year, month, 1, 12, 0, 0)));
}

function lastOfMonth(year: number, month: number): string {
	const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return isoDate(new Date(Date.UTC(year, month, maxDay, 12, 0, 0)));
}

export function firstDayOfMonthIso(todayIso: string): string {
	const { year, month } = monthParts(todayIso);
	return firstOfMonth(year, month);
}

export function lastDayOfMonthIso(todayIso: string): string {
	const { year, month } = monthParts(todayIso);
	return lastOfMonth(year, month);
}

export function flowPresetRange(
	id: FlowRangePresetId,
	today: string,
): FlowWindow {
	const { year, month } = monthParts(today);
	switch (id) {
		case "this-month":
			return {
				startDate: firstOfMonth(year, month),
				endDate: lastOfMonth(year, month),
			};
		case "last-month":
			return {
				startDate: firstOfMonth(year, month - 1),
				endDate: lastOfMonth(year, month - 1),
			};
		case "last-3-months":
			return {
				startDate: firstOfMonth(year, month - 2),
				endDate: lastOfMonth(year, month),
			};
		case "year-to-date":
			return {
				startDate: firstOfMonth(year, 0),
				endDate: lastOfMonth(year, month),
			};
		case "last-12-months":
			return {
				startDate: firstOfMonth(year, month - 11),
				endDate: lastOfMonth(year, month),
			};
	}
}

export const FLOW_RANGE_PRESETS: Array<{ id: FlowRangePresetId; label: string }> =
	[
		{ id: "this-month", label: "This month" },
		{ id: "last-month", label: "Last month" },
		{ id: "last-3-months", label: "Last 3 months" },
		{ id: "year-to-date", label: "Year to date" },
		{ id: "last-12-months", label: "Last 12 months" },
	];

export function matchFlowPreset(
	window: FlowWindow,
	today: string,
): FlowRangePresetId | null {
	for (const preset of FLOW_RANGE_PRESETS) {
		const range = flowPresetRange(preset.id, today);
		if (
			range.startDate === window.startDate &&
			range.endDate === window.endDate
		) {
			return preset.id;
		}
	}
	return null;
}

export function defaultFlowWindow(today: string): FlowWindow {
	return flowPresetRange("this-month", today);
}
