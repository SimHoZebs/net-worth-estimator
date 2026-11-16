import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "@/domain/model.ts";
import { cardScheduledOutflows } from "./cardScheduledOutflows.ts";

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
		sourceAccountId: "card-1",
		...overrides,
	};
}

function oneTime(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		id,
		name: id,
		amount: 40,
		amountKnown: true,
		fromId: "card-1",
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

describe("cardScheduledOutflows", () => {
	it("expands enabled schedule occurrences after today", () => {
		const bumps = cardScheduledOutflows({
			schedules: [schedule("sub", { startDate: "2026-11-18" })],
			transactions: [],
			trackedIds: ["card-1"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([{ date: "2026-11-18", amount: 25, name: "sub" }]);
	});

	it("includes future one-time card outflows", () => {
		const bumps = cardScheduledOutflows({
			schedules: [],
			transactions: [
				oneTime("future", { startDate: "2026-11-20", amount: 40 }),
			],
			trackedIds: ["card-1"],
			accountIds: ["card-1", "cash"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([{ date: "2026-11-20", amount: 40, name: "future" }]);
	});

	it("excludes transfers to known accounts", () => {
		const bumps = cardScheduledOutflows({
			schedules: [
				schedule("card-transfer", {
					startDate: "2026-11-18",
					destinations: ["cash"],
				}),
			],
			transactions: [
				oneTime("transfer", { startDate: "2026-11-20", toId: "cash" }),
			],
			trackedIds: ["card-1"],
			accountIds: ["card-1", "cash"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([]);
	});

	it("dedupes claimed schedule occurrences but keeps the claiming charge", () => {
		const claimed = oneTime("claim", {
			startDate: "2026-11-18",
			amount: 30,
			claimScheduleId: "sub",
			claimOccurrenceDate: "2026-11-18",
		});
		const bumps = cardScheduledOutflows({
			schedules: [schedule("sub", { startDate: "2026-11-18" })],
			transactions: [claimed],
			trackedIds: ["card-1"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([{ date: "2026-11-18", amount: 30, name: "claim" }]);
	});

	it("skips disabled schedules and unknown amounts", () => {
		const bumps = cardScheduledOutflows({
			schedules: [
				schedule("disabled", { enabled: false }),
				schedule("varies", {
					amount: { resolver: "expression", config: {}, inputs: {} },
				}),
				schedule("other-card", { sourceAccountId: "card-2" }),
			],
			transactions: [
				oneTime("disabled-tx", { enabled: false }),
				oneTime("unknown-tx", { amountKnown: false, amount: 0 }),
				oneTime("void-tx", { void: true }),
				oneTime("other-card-tx", { fromId: "card-2" }),
			],
			trackedIds: ["card-1"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([]);
	});

	it("filters dates to after today through cycle end and groups by date", () => {
		const bumps = cardScheduledOutflows({
			schedules: [
				schedule("today", { startDate: "2026-11-15" }),
				schedule("past", { startDate: "2026-10-15", frequency: "monthly" }),
			],
			transactions: [
				oneTime("today-tx", { startDate: "2026-11-15" }),
				oneTime("past-tx", { startDate: "2026-11-14" }),
				oneTime("after-end", { startDate: "2026-12-01" }),
				oneTime("first", {
					startDate: "2026-11-20",
					amount: 10,
					name: "alpha",
				}),
				oneTime("second", {
					startDate: "2026-11-20",
					amount: 15.005,
					name: "beta",
				}),
			],
			trackedIds: ["card-1"],
			today: "2026-11-15",
			cycleEnd: "2026-11-30",
		});
		expect(bumps).toEqual([
			{ date: "2026-11-20", amount: 25.01, name: "alpha, beta" },
		]);
	});

	it("returns empty without tracked cards or with an invalid range", () => {
		expect(
			cardScheduledOutflows({
				schedules: [schedule("sub")],
				transactions: [oneTime("future")],
				trackedIds: [],
				today: "2026-11-15",
				cycleEnd: "2026-11-30",
			}),
		).toEqual([]);
		expect(
			cardScheduledOutflows({
				schedules: [schedule("sub")],
				transactions: [oneTime("future")],
				trackedIds: ["card-1"],
				today: "2026-12-01",
				cycleEnd: "2026-11-30",
			}),
		).toEqual([]);
	});
});
