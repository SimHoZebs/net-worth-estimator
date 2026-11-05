import { describe, expect, it } from "vitest";

import {
	claimOccurrenceCandidates,
	scheduleOccurrenceDates,
} from "./ruleSchedule.ts";

describe("scheduleOccurrenceDates", () => {
	const through = "2026-11-04";

	it("expands monthly rules from the start date", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-08-15",
				endDate: null,
				frequency: "monthly",
				through,
			}),
		).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
	});

	it("stops at the rule end date when it precedes today", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-08-15",
				endDate: "2026-09-30",
				frequency: "monthly",
				through,
			}),
		).toEqual(["2026-08-15", "2026-09-15"]);
	});

	it("returns nothing for a rule that starts after today", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-12-01",
				endDate: null,
				frequency: "monthly",
				through,
			}),
		).toEqual([]);
	});

	it("clamps monthly expansions to the end of short months", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-01-31",
				endDate: null,
				frequency: "monthly",
				through: "2026-05-31",
			}),
		).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-31",
			"2026-04-30",
			"2026-05-31",
		]);
	});

	it("expands weekly and annual rules", () => {
		expect(
			scheduleOccurrenceDates({
				startDate: "2026-10-21",
				endDate: null,
				frequency: "weekly",
				through,
			}),
		).toEqual(["2026-10-21", "2026-10-28", "2026-11-04"]);
		expect(
			scheduleOccurrenceDates({
				startDate: "2025-11-04",
				endDate: null,
				frequency: "annual",
				through,
			}),
		).toEqual(["2025-11-04", "2026-11-04"]);
	});
});

describe("claimOccurrenceCandidates", () => {
	const schedule = {
		startDate: "2026-09-01",
		endDate: null,
		frequency: "monthly",
	};

	it("sorts scheduled dates by distance to the posted day", () => {
		expect(
			claimOccurrenceCandidates({
				schedule,
				through: "2026-11-04",
				postedRef: "2026-10-20",
				claimed: new Set(),
			}),
		).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
	});

	it("excludes dates another row already claimed", () => {
		expect(
			claimOccurrenceCandidates({
				schedule,
				through: "2026-11-04",
				postedRef: "2026-10-20",
				claimed: new Set(["2026-10-01"]),
			}),
		).toEqual(["2026-11-01", "2026-09-01"]);
	});
});
