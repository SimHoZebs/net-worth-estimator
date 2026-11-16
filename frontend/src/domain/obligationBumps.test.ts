import { describe, expect, it } from "vitest";
import type { SafeSpendingObligation } from "@/api/generated/model/safeSpendingObligation.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "@/domain/model.ts";
import { obligationBumps } from "./obligationBumps.ts";

function obligation(
	id: string,
	overrides: Partial<SafeSpendingObligation> = {},
): SafeSpendingObligation {
	return {
		id,
		accountId: "checking",
		amount: 25,
		date: "2026-11-18",
		name: id,
		scheduleId: "rent",
		status: "outstanding",
		transactionId: null,
		...overrides,
	};
}

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
		destinations: [],
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
	schedules: [schedule("rent")],
	transactions: [],
	accountIds: ["checking", "card-1", "savings"],
	today: "2026-11-15",
	cycleEnd: "2026-11-30",
};

describe("obligationBumps", () => {
	it("steps for backend bill rows in the bump window", () => {
		const bumps = obligationBumps({
			obligations: [obligation("schedule:rent:2026-11-18", { name: "rent" })],
			...args,
		});
		expect(bumps).toEqual([{ date: "2026-11-18", amount: 25, name: "rent" }]);
	});

	it("ignores rows outside the window and unknown amounts", () => {
		const bumps = obligationBumps({
			obligations: [
				obligation("today", { date: "2026-11-15" }),
				obligation("past", { date: "2026-11-14" }),
				obligation("after-end", { date: "2026-12-01" }),
				obligation("unknown", { date: "2026-11-20", amount: null }),
				obligation("zero", { date: "2026-11-20", amount: 0 }),
			],
			...args,
		});
		expect(bumps).toEqual([]);
	});

	it("excludes transfers to known accounts", () => {
		const bumps = obligationBumps({
			obligations: [
				obligation("schedule:card-payment:2026-11-18", {
					name: "card-payment",
					scheduleId: "card-payment",
				}),
			],
			schedules: [
				schedule("rent"),
				schedule("card-payment", { destinations: ["card-1"] }),
			],
			transactions: [],
			accountIds: args.accountIds,
			today: args.today,
			cycleEnd: args.cycleEnd,
		});
		expect(bumps).toEqual([]);
	});

	it("skips already claimed occurrences recorded in actual spending", () => {
		const bumps = obligationBumps({
			obligations: [obligation("schedule:rent:2026-11-18")],
			schedules: args.schedules,
			transactions: [
				posted("claim", {
					claimScheduleId: "rent",
					claimOccurrenceDate: "2026-11-18",
				}),
			],
			accountIds: args.accountIds,
			today: args.today,
			cycleEnd: args.cycleEnd,
		});
		expect(bumps).toEqual([]);
	});

	it("groups same-day rows and sums cents", () => {
		const bumps = obligationBumps({
			obligations: [
				obligation("schedule:rent:2026-11-20", {
					date: "2026-11-20",
					amount: 10,
					name: "alpha",
				}),
				obligation("schedule:gym:2026-11-20", {
					date: "2026-11-20",
					amount: 15.005,
					name: "beta",
					scheduleId: "gym",
				}),
			],
			schedules: [schedule("rent"), schedule("gym")],
			transactions: [],
			accountIds: args.accountIds,
			today: args.today,
			cycleEnd: args.cycleEnd,
		});
		expect(bumps).toEqual([
			{ date: "2026-11-20", amount: 25.01, name: "alpha, beta" },
		]);
	});

	it("returns empty with an invalid range", () => {
		expect(
			obligationBumps({
				obligations: [obligation("schedule:rent:2026-11-18")],
				...args,
				today: "2026-12-01",
			}),
		).toEqual([]);
	});
});
