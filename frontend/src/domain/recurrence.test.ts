import { describe, expect, it } from "vitest";
import {
	ensureStartWeekday,
	monthlyNthWeekdayDate,
	recurrenceEqual,
	recurrenceFromFrequency,
	recurrenceFromScheduleLike,
	recurrenceOccurrenceDates,
	recurrenceSentence,
	validateRecurrence,
} from "./recurrence.ts";
import { scheduleOccurrenceDates } from "./scheduleExpansion.ts";

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

describe("recurrence expansion", () => {
	it("expands every 2 months by date", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-15",
				recurrence: { unit: "month", interval: 2, monthlyMode: "byDate" },
				endDate: null,
				through: "2026-06-30",
			}),
		).toEqual(["2026-01-15", "2026-03-15", "2026-05-15"]);
	});
	it("expands every 3 weeks on Sunday", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-04",
				recurrence: { unit: "week", interval: 3, weekdays: [0] },
				endDate: null,
				through: "2026-02-28",
			}),
		).toEqual(["2026-01-04", "2026-01-25", "2026-02-15"]);
	});
	it("expands monthly on the third Tuesday", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-20",
				recurrence: { unit: "month", interval: 1, monthlyMode: "byNthWeekday" },
				endDate: null,
				through: "2026-03-31",
			}),
		).toEqual(["2026-01-20", "2026-02-17", "2026-03-17"]);
	});
	it("clamps month-end starts to shorter months", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-31",
				recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
				endDate: null,
				through: "2026-04-30",
			}),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
	});
	it("expands monthly on the last Friday", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-30",
				recurrence: { unit: "month", interval: 1, monthlyMode: "byNthWeekday" },
				endDate: null,
				through: "2026-03-31",
			}),
		).toEqual(["2026-01-30", "2026-02-27", "2026-03-27"]);
	});
	it("expands weekly Tue and Thu", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-06",
				recurrence: { unit: "week", interval: 1, weekdays: [2, 4] },
				endDate: null,
				through: "2026-01-15",
			}),
		).toEqual(["2026-01-06", "2026-01-08", "2026-01-13", "2026-01-15"]);
	});
	it("respects the schedule end date", () => {
		expect(
			recurrenceOccurrenceDates({
				startDate: "2026-01-06",
				recurrence: { unit: "week", interval: 1, weekdays: [2, 4] },
				endDate: "2026-01-08",
				through: "2026-01-31",
			}),
		).toEqual(["2026-01-06", "2026-01-08"]);
	});
	it("returns null for a nonexistent non-last fifth weekday", () => {
		expect(
			monthlyNthWeekdayDate({
				year: 2026,
				month: 2,
				weekday: 1,
				nth: 5,
				last: false,
			}),
		).toBeNull();
		expect(
			monthlyNthWeekdayDate({
				year: 2026,
				month: 2,
				weekday: 1,
				nth: 5,
				last: true,
			}),
		).toBe("2026-02-23");
	});
});

describe("recurrence migration helpers", () => {
	it("maps legacy frequencies to recurrences", () => {
		expect(recurrenceFromFrequency("daily", "2026-01-06")).toEqual({
			unit: "day",
			interval: 1,
		});
		expect(recurrenceFromFrequency("weekly", "2026-01-06")).toEqual({
			unit: "week",
			interval: 1,
			weekdays: [2],
		});
		expect(recurrenceFromFrequency("monthly", "2026-01-06")).toEqual({
			unit: "month",
			interval: 1,
			monthlyMode: "byDate",
		});
		expect(recurrenceFromFrequency("quarterly", "2026-01-06")).toEqual({
			unit: "month",
			interval: 3,
			monthlyMode: "byDate",
		});
		expect(recurrenceFromFrequency("annual", "2026-01-06")).toEqual({
			unit: "year",
			interval: 1,
		});
	});
	it("reads stored schedules with recurrence or legacy frequency", () => {
		const recurrence = { unit: "week", interval: 1, weekdays: [2] } as const;
		expect(
			recurrenceFromScheduleLike({
				recurrence,
				frequency: "monthly",
				startDate: "2026-01-06",
			}),
		).toEqual({ unit: "week", interval: 1, weekdays: [2] });
		expect(
			recurrenceFromScheduleLike({
				frequency: "quarterly",
				startDate: "2026-01-06",
			}),
		).toEqual({ unit: "month", interval: 3, monthlyMode: "byDate" });
		expect(recurrenceFromScheduleLike(null)).toBeNull();
	});
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
	it("expands legacy frequencies through the compat shim", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-01-15",
				endDate: null,
				frequency: "monthly",
				through: "2026-03-31",
			}),
		).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-01-15",
				endDate: null,
				frequency: "quarterly",
				through: "2026-12-31",
			}),
		).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
	});
});
