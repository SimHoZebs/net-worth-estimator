import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import { billCandidates, effectiveBillIds } from "./safeSpendingBills.ts";

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
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: "2026-01-01",
		endDate: null,
		annualCap: null,
		priority: 1,
	}) as Schedule;

describe("billCandidates", () => {
	it("keeps calculated bills selectable without inventing their amount", () => {
		const recipe = schedule("percent", "checking");
		recipe.amount = {
			resolver: "expression",
			config: { expression: "balance * 0.1" },
			inputs: {},
		};
		expect(billCandidates([recipe], ["checking"])).toEqual([
			{ id: "percent", name: "percent", amount: null },
		]);
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
