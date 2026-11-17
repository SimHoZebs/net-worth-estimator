import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import { transactionFixture } from "@/mocks/projection.ts";
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
	it("filters by bill id and inclusive cycle dates without posting checks", () => {
		const rows = [
			transactionFixture({
				transactionId: "rent",
				date: "2026-10-20",
				posted: true,
			}),
			transactionFixture({
				transactionId: "rent",
				date: "2026-11-20",
			}),
			transactionFixture({
				transactionId: "gym",
				date: "2026-11-21",
			}),
			transactionFixture({
				transactionId: "rent",
				date: "2026-11-19",
			}),
		];
		expect(billsInCycle(rows, ["rent"], "2026-10-20", "2026-11-20")).toEqual([
			rows[0],
			rows[1],
			rows[3],
		]);
	});
});
