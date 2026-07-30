import { describe, expect, it } from "vitest";
import { runReactiveBehavior } from "../behavior/runtime";

describe("runReactiveBehavior", () => {
	it("stops after the period that satisfies shouldStop", () => {
		const result = runReactiveBehavior(
			[0, 1, 2, 3].map((index) => ({
				index,
				startDate: `2026-0${index + 1}-01`,
				endDate: `2026-0${index + 2}-01`,
			})),
			{
				initialize: () => ({ visited: [] as number[] }),
				react: (state, period) => state.visited.push(period.index),
				shouldStop: (_state, period) => period.index === 1,
				finish: (state) => state.visited,
			},
		);

		expect(result).toEqual([0, 1]);
	});
});
