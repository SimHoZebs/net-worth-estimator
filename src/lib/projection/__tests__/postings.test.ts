import { describe, expect, it } from "vitest";
import { makeAccount, makePosting } from "../__fixtures__";
import {
	addOccurrences,
	frequencyDivisor,
	resolveAccountMovement,
} from "../simulation/postings";

describe("posting recurrence", () => {
	function occurrenceDates(
		postingOverrides: Parameters<typeof makePosting>[0],
		projectionStartDate: string,
		projectionEndDate: string,
		includeStartDate = true,
	) {
		const eventDates = new Map();
		addOccurrences(
			[makePosting(postingOverrides)],
			eventDates,
			projectionStartDate,
			projectionEndDate,
			includeStartDate,
		);
		return [...eventDates.keys()];
	}

	it.each([
		["once", 1],
		["daily", 365],
		["weekly", 52],
		["monthly", 12],
		["quarterly", 4],
		["annual", 1],
	] as const)("uses the %s annual divisor", (frequency, divisor) => {
		expect(frequencyDivisor(frequency)).toBe(divisor);
	});

	it.each([
		["once", "2026-01-15", "2026-02-01", ["2026-01-15"]],
		[
			"daily",
			"2026-01-15",
			"2026-01-17",
			["2026-01-15", "2026-01-16", "2026-01-17"],
		],
		[
			"weekly",
			"2026-01-15",
			"2026-01-29",
			["2026-01-15", "2026-01-22", "2026-01-29"],
		],
	] as const)("adds inclusive %s occurrences", (frequency, startDate, projectionEndDate, expected) => {
		expect(
			occurrenceDates(
				{ id: `posting-${frequency}`, frequency, startDate },
				startDate,
				projectionEndDate,
			),
		).toEqual(expected);
	});

	it.each([
		[
			"monthly",
			"2026-01-31",
			"2026-03-31",
			["2026-01-31", "2026-02-28", "2026-03-31"],
		],
		[
			"quarterly",
			"2026-01-31",
			"2026-07-31",
			["2026-01-31", "2026-04-30", "2026-07-31"],
		],
		[
			"annual",
			"2024-02-29",
			"2028-02-29",
			["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
		],
	] as const)("anchors clamped %s occurrences to the original start date", (frequency, startDate, projectionEndDate, expected) => {
		expect(
			occurrenceDates(
				{ id: `posting-${frequency}`, frequency, startDate },
				startDate,
				projectionEndDate,
			),
		).toEqual(expected);
	});

	it("honors projection-start inclusion, posting end dates, and disabled rows", () => {
		expect(
			occurrenceDates(
				{
					id: "bounded-monthly",
					frequency: "monthly",
					startDate: "2026-01-15",
					endDate: "2026-03-15",
				},
				"2026-02-15",
				"2026-12-31",
				false,
			),
		).toEqual(["2026-03-15"]);
		expect(
			occurrenceDates(
				{
					id: "disabled-daily",
					enabled: false,
					frequency: "daily",
					startDate: "2026-01-01",
				},
				"2026-01-01",
				"2026-01-03",
			),
		).toEqual([]);
	});
});

describe("account movement resolution", () => {
	it("returns raw unavailable-source movement facts", () => {
		const result = resolveAccountMovement(
			{
				sourceAccountId: "missing",
				destinations: null,
				requestedAmount: 100,
			},
			{},
			new Map(),
		);

		expect(result).toEqual({
			requestedAmount: 100,
			realizedAmount: 0,
		});
	});

	it("resolves tied source-floor and caller action limits", () => {
		const source = makeAccount({ id: "cash", minBalance: 50 });
		const result = resolveAccountMovement(
			{
				sourceAccountId: source.id,
				destinations: null,
				requestedAmount: 100,
				limitRemaining: 50,
			},
			{ cash: 100 },
			new Map([[source.id, source]]),
		);

		expect(result.realizedAmount).toBe(50);
		expect(result.requestedAmount - result.realizedAmount).toBe(50);
	});

	it("enforces a tied destination ceiling", () => {
		const source = makeAccount({ id: "cash", minBalance: 0 });
		const destination = makeAccount({ id: "loan", maxBalance: 0 });
		const result = resolveAccountMovement(
			{
				sourceAccountId: source.id,
				destinations: [destination.id],
				requestedAmount: 200,
			},
			{ cash: 100, loan: -100 },
			new Map([
				[source.id, source],
				[destination.id, destination],
			]),
		);

		expect(result.realizedAmount).toBe(100);
	});

	it("does not bind constraints for a zero request", () => {
		const result = resolveAccountMovement(
			{
				sourceAccountId: "missing",
				destinations: null,
				requestedAmount: 0,
			},
			{},
			new Map(),
		);

		expect(result.requestedAmount - result.realizedAmount).toBe(0);
	});
});
