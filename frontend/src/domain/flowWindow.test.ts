import { describe, expect, it } from "vitest";
import {
	defaultFlowWindow,
	firstDayOfMonthIso,
	flowPresetRange,
	lastDayOfMonthIso,
	matchFlowPreset,
} from "./flowWindow.ts";

describe("flowWindow month boundaries", () => {
	it("returns first and last day of the current month", () => {
		expect(firstDayOfMonthIso("2026-03-15")).toBe("2026-03-01");
		expect(lastDayOfMonthIso("2026-03-15")).toBe("2026-03-31");
		expect(lastDayOfMonthIso("2026-04-01")).toBe("2026-04-30");
	});

	it("handles leap year February", () => {
		expect(firstDayOfMonthIso("2024-02-15")).toBe("2024-02-01");
		expect(lastDayOfMonthIso("2024-02-15")).toBe("2024-02-29");
		expect(lastDayOfMonthIso("2023-02-15")).toBe("2023-02-28");
	});

	it("resolves this-month to whole current month", () => {
		expect(flowPresetRange("this-month", "2026-03-15")).toEqual({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
		});
	});

	it("rolls last-month back across the year boundary", () => {
		expect(flowPresetRange("last-month", "2026-01-20")).toEqual({
			startDate: "2025-12-01",
			endDate: "2025-12-31",
		});
		expect(flowPresetRange("last-month", "2024-03-10")).toEqual({
			startDate: "2024-02-01",
			endDate: "2024-02-29",
		});
	});

	it("spans last-3-months from two months ago through current month", () => {
		expect(flowPresetRange("last-3-months", "2026-03-15")).toEqual({
			startDate: "2026-01-01",
			endDate: "2026-03-31",
		});
		expect(flowPresetRange("last-3-months", "2026-01-20")).toEqual({
			startDate: "2025-11-01",
			endDate: "2026-01-31",
		});
	});

	it("starts year-to-date on Jan 1 of the current year", () => {
		expect(flowPresetRange("year-to-date", "2026-03-15")).toEqual({
			startDate: "2026-01-01",
			endDate: "2026-03-31",
		});
		expect(flowPresetRange("year-to-date", "2026-01-20")).toEqual({
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});
	});

	it("spans last-12-months across the year boundary", () => {
		expect(flowPresetRange("last-12-months", "2026-01-20")).toEqual({
			startDate: "2025-02-01",
			endDate: "2026-01-31",
		});
		expect(flowPresetRange("last-12-months", "2026-03-15")).toEqual({
			startDate: "2025-04-01",
			endDate: "2026-03-31",
		});
	});
});

describe("matchFlowPreset", () => {
	it("matches each preset range exactly", () => {
		expect(
			matchFlowPreset(
				{ startDate: "2026-03-01", endDate: "2026-03-31" },
				"2026-03-15",
			),
		).toBe("this-month");
		expect(
			matchFlowPreset(
				{ startDate: "2026-02-01", endDate: "2026-02-28" },
				"2026-03-15",
			),
		).toBe("last-month");
	});

	it("returns null for custom windows", () => {
		expect(
			matchFlowPreset(
				{ startDate: "2026-03-10", endDate: "2026-03-31" },
				"2026-03-15",
			),
		).toBeNull();
		expect(
			matchFlowPreset(
				{ startDate: "2026-03-01", endDate: "2026-03-30" },
				"2026-03-15",
			),
		).toBeNull();
	});
});

describe("defaultFlowWindow", () => {
	it("defaults to this-month", () => {
		expect(defaultFlowWindow("2026-03-15")).toEqual(
			flowPresetRange("this-month", "2026-03-15"),
		);
	});
});
