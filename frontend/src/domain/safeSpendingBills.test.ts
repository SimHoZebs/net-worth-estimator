import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import {
	billCandidates,
	billsInCycle,
	effectiveBillIds,
} from "./safeSpendingBills.ts";

const schedule = (id: string, sourceAccountId: string | null, enabled = true) =>
	({
		id,
		name: id,
		enabled,
		sourceAccountId,
		destinations: [],
		amount: {
			resolver: "expression",
			config: { expression: "120" },
			inputs: {},
		},
		frequency: "monthly",
		startDate: "2026-01-01",
		endDate: null,
		annualCap: null,
		priority: 1,
	}) as Schedule;

describe("billCandidates", () => {
	it("excludes calculated amounts that cannot be displayed as a bill", () => {
		const recipe = schedule("percent", "checking");
		recipe.amount = {
			resolver: "expression",
			config: { expression: "balance * 0.1" },
			inputs: {},
		};
		expect(billCandidates([recipe], ["checking"])).toEqual([]);
	});

	it("keeps enabled schedules sourced from selected cash accounts", () => {
		expect(
			billCandidates(
				[
					schedule("rent", "checking"),
					schedule("savings-plan", "savings"),
					schedule("closed", "checking", false),
					schedule("external", null),
				],
				["checking"],
			),
		).toEqual([{ id: "rent", name: "rent", amount: 120 }]);
	});

	it("resolves the effective bill selection with null-means-all", () => {
		const candidates = billCandidates(
			[schedule("rent", "checking"), schedule("gym", "checking")],
			["checking"],
		);
		expect(effectiveBillIds(null, candidates)).toEqual(["rent", "gym"]);
		expect(effectiveBillIds(["gym"], candidates)).toEqual(["gym"]);
	});
});

describe("billsInCycle", () => {
	it("lists only the selected schedules' occurrences inside the cycle", () => {
		const schedules = [
			schedule("rent", "checking"),
			schedule("gym", "checking"),
		];
		const rows = billsInCycle(schedules, ["rent"], "2026-10-20", "2026-11-20");
		expect(
			rows.map((row) => [row.transactionId, row.date, row.requested]),
		).toEqual([["rent", "2026-11-01", 120]]);
	});
});
