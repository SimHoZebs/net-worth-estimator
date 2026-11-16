import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "@/domain/model.ts";
import { recurringBillBumps } from "./recurringBillBumps.ts";

function schedule(id: string, overrides: Partial<Schedule> = {}): Schedule {
	return {
		id,
		name: id,
		amount: {
			resolver: "expression",
			config: { expression: "25" },
			inputs: {},
		},
		frequency: "monthly",
		startDate: "2026-11-18",
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
		destinations: null,
		sourceAccountId: "checking",
		...overrides,
	};
}

function posted(id: string, overrides: Partial<Transaction> = {}): Transaction {
	return {
		id,
		name: id,
		amount: 40,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "transaction",
		startDate: "2026-11-20",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: false,
		...overrides,
	};
}

const args = {
	trackedBillIds: ["rent"],
	accountIds: ["checking", "card-1", "savings"],
	today: "2026-11-15",
	cycleEnd: "2026-11-30",
};

describe("recurringBillBumps", () => {
	it("expands included bill occurrences after today", () => {
		const bumps = recurringBillBumps({
			schedules: [schedule("rent", { startDate: "2026-11-18" })],
			transactions: [],
			...args,
		});
		expect(bumps).toEqual([{ date: "2026-11-18", amount: 25, name: "rent" }]);
	});

	it("ignores schedules outside the Included bills selection", () => {
		const bumps = recurringBillBumps({
			schedules: [schedule("deselected", { startDate: "2026-11-18" })],
			transactions: [],
			...args,
		});
		expect(bumps).toEqual([]);
	});

	it("excludes transfers to known accounts", () => {
		const bumps = recurringBillBumps({
			schedules: [
				schedule("card-payment", {
					startDate: "2026-11-18",
					destinations: ["card-1"],
				}),
			],
			transactions: [],
			...args,
			trackedBillIds: ["card-payment"],
		});
		expect(bumps).toEqual([]);
	});

	it("dedupes claimed schedule occurrences", () => {
		const bumps = recurringBillBumps({
			schedules: [schedule("rent", { startDate: "2026-11-18" })],
			transactions: [
				posted("claim", {
					claimScheduleId: "rent",
					claimOccurrenceDate: "2026-11-18",
				}),
			],
			...args,
		});
		expect(bumps).toEqual([]);
	});

	it("skips disabled schedules and unknown amounts", () => {
		const bumps = recurringBillBumps({
			schedules: [
				schedule("disabled", { enabled: false }),
				schedule("varies", {
					amount: { resolver: "expression", config: {}, inputs: {} },
				}),
				schedule("income-like", { sourceAccountId: null }),
			],
			transactions: [],
			...args,
			trackedBillIds: ["disabled", "varies", "income-like"],
		});
		expect(bumps).toEqual([]);
	});

	it("filters dates to after today through cycle end and groups by date", () => {
		const bumps = recurringBillBumps({
			schedules: [
				schedule("today", { startDate: "2026-11-15" }),
				schedule("past", { startDate: "2026-10-15", frequency: "monthly" }),
				schedule("first", {
					startDate: "2026-11-20",
					amount: {
						resolver: "expression",
						config: { expression: "10" },
						inputs: {},
					},
				}),
				schedule("second", {
					startDate: "2026-11-20",
					amount: {
						resolver: "expression",
						config: { expression: "15.005" },
						inputs: {},
					},
				}),
			],
			transactions: [],
			...args,
			trackedBillIds: ["today", "past", "first", "second"],
		});
		expect(bumps).toEqual([
			{ date: "2026-11-20", amount: 25.01, name: "first, second" },
		]);
	});

	it("returns empty without included bills or with an invalid range", () => {
		expect(
			recurringBillBumps({
				schedules: [schedule("rent")],
				transactions: [],
				...args,
				trackedBillIds: [],
			}),
		).toEqual([]);
		expect(
			recurringBillBumps({
				schedules: [schedule("rent")],
				transactions: [],
				...args,
				today: "2026-12-01",
			}),
		).toEqual([]);
	});
});
