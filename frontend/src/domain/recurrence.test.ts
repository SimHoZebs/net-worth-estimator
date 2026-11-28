import { describe, expect, it } from "vitest";
import {
	ensureStartWeekday,
	recurrenceEqual,
	recurrenceFromScheduleLike,
	recurrenceSentence,
	validateRecurrence,
} from "./recurrence.ts";

describe("recurrence sentences", () => {
	it("words daily repeats", () => {
		expect(recurrenceSentence({ unit: "day", interval: 1 }, "2026-01-15")).toBe(
			"Every day",
		);
		expect(recurrenceSentence({ unit: "day", interval: 3 }, "2026-01-15")).toBe(
			"Every 3 days",
		);
	});
	it("words weekly repeats with weekday names", () => {
		expect(
			recurrenceSentence(
				{ unit: "week", interval: 1, weekdays: [2] },
				"2026-01-06",
			),
		).toBe("Every week on Tuesday");
		expect(
			recurrenceSentence(
				{ unit: "week", interval: 2, weekdays: [2, 4] },
				"2026-01-06",
			),
		).toBe("Every 2 weeks on Tue, Thu");
	});
	it("words monthly repeats by date", () => {
		expect(
			recurrenceSentence(
				{ unit: "month", interval: 1, monthlyMode: "byDate" },
				"2026-01-15",
			),
		).toBe("Every month on the 15th");
		expect(
			recurrenceSentence(
				{ unit: "month", interval: 2, monthlyMode: "byDate" },
				"2026-01-15",
			),
		).toBe("Every 2 months on the 15th");
	});
	it("words monthly repeats by nth weekday", () => {
		expect(
			recurrenceSentence(
				{ unit: "month", interval: 1, monthlyMode: "byNthWeekday" },
				"2026-01-20",
			),
		).toBe("Monthly on the third Tuesday");
	});
	it("words yearly repeats", () => {
		expect(
			recurrenceSentence({ unit: "year", interval: 1 }, "2026-01-15"),
		).toBe("Every year on Jan 15");
	});
});

describe("recurrence validation", () => {
	it("rejects out-of-range intervals", () => {
		expect(validateRecurrence({ unit: "day", interval: 0 }, "2026-01-15")).toBe(
			"Enter a repeat interval from 1 to 99.",
		);
		expect(
			validateRecurrence({ unit: "day", interval: 100 }, "2026-01-15"),
		).toBe("Enter a repeat interval from 1 to 99.");
		expect(
			validateRecurrence({ unit: "day", interval: 1.5 }, "2026-01-15"),
		).toBe("Enter a repeat interval from 1 to 99.");
	});
	it("requires weekly days including the first occurrence weekday", () => {
		expect(
			validateRecurrence(
				{ unit: "week", interval: 1, weekdays: [] },
				"2026-01-06",
			),
		).toBe("Choose at least one weekday.");
		expect(
			validateRecurrence(
				{ unit: "week", interval: 1, weekdays: [3] },
				"2026-01-06",
			),
		).toBe("The repeat days must include the first occurrence weekday.");
		expect(
			validateRecurrence(
				{ unit: "week", interval: 1, weekdays: [2, 4] },
				"2026-01-06",
			),
		).toBeNull();
	});
	it("requires a monthly anchor mode", () => {
		expect(
			validateRecurrence({ unit: "month", interval: 1 }, "2026-01-15"),
		).toBe("Choose how the monthly schedule anchors.");
		expect(
			validateRecurrence(
				{ unit: "month", interval: 1, monthlyMode: "byDate" },
				"2026-01-15",
			),
		).toBeNull();
	});
	it("rejects members on the wrong unit", () => {
		expect(
			validateRecurrence(
				{ unit: "day", interval: 1, weekdays: [4] },
				"2026-01-15",
			),
		).toBe("Weekdays only apply to weekly schedules.");
		expect(
			validateRecurrence(
				{ unit: "week", interval: 1, weekdays: [4], monthlyMode: "byDate" },
				"2026-01-15",
			),
		).toBe("The monthly anchor only applies to monthly schedules.");
		expect(
			validateRecurrence(
				{ unit: "month", interval: 1, monthlyMode: "byDate" },
				"2026-01-15",
			),
		).toBeNull();
	});
});

describe("current schedule recurrence reader", () => {
	it("preserves valid current recurrence fields", () => {
		expect(
			recurrenceFromScheduleLike({
				recurrence: { unit: "week", interval: 2, weekdays: [4, 2] },
				startDate: "2026-01-06",
			}),
		).toEqual({ unit: "week", interval: 2, weekdays: [4, 2] });
		expect(
			recurrenceFromScheduleLike({
				recurrence: {
					unit: "month",
					interval: 3,
					monthlyMode: "byNthWeekday",
				},
				startDate: "2026-01-20",
			}),
		).toEqual({
			unit: "month",
			interval: 3,
			monthlyMode: "byNthWeekday",
		});
		expect(
			recurrenceFromScheduleLike({
				recurrence: { unit: "day", interval: 1 },
				startDate: "2026-01-06",
			}),
		).toEqual({ unit: "day", interval: 1 });
	});
	it.each([
		undefined,
		null,
		{},
		{ frequency: "monthly" },
		{ unit: "fortnight", interval: 1 },
		{ unit: "day", interval: 0 },
		{ unit: "day", interval: 100 },
		{ unit: "day", interval: 1.5 },
		{ unit: "day", interval: "1" },
		{ unit: "week", interval: 1 },
		{ unit: "week", interval: 1, weekdays: null },
		{ unit: "week", interval: 1, weekdays: [] },
		{ unit: "week", interval: 1, weekdays: [2, 2] },
		{ unit: "week", interval: 1, weekdays: [2, 7] },
		{ unit: "week", interval: 1, weekdays: [3] },
		{ unit: "month", interval: 1 },
		{ unit: "month", interval: 1, monthlyMode: "byWeek" },
		{ unit: "day", interval: 1, weekdays: [2] },
		{ unit: "year", interval: 1, monthlyMode: "byDate" },
	])("rejects malformed current recurrence %#", (recurrence) => {
		expect(
			recurrenceFromScheduleLike({ recurrence, startDate: "2026-01-06" }),
		).toBeNull();
	});
	it("rejects missing schedules and invalid start dates", () => {
		expect(recurrenceFromScheduleLike(null)).toBeNull();
		expect(
			recurrenceFromScheduleLike({
				recurrence: { unit: "day", interval: 1 },
				startDate: "2026-13-01",
			}),
		).toBeNull();
	});
});

describe("recurrence helpers", () => {
	it("compares recurrences ignoring weekday order", () => {
		expect(
			recurrenceEqual(
				{ unit: "week", interval: 1, weekdays: [4, 2] },
				{ unit: "week", interval: 1, weekdays: [2, 4] },
			),
		).toBe(true);
		expect(
			recurrenceEqual(
				{ unit: "week", interval: 1, weekdays: [2] },
				{ unit: "week", interval: 2, weekdays: [2] },
			),
		).toBe(false);
	});
	it("keeps the start weekday when the start date moves", () => {
		expect(
			ensureStartWeekday(
				{ unit: "week", interval: 1, weekdays: [2] },
				"2026-01-08",
			),
		).toEqual({ unit: "week", interval: 1, weekdays: [2, 4] });
	});
});
