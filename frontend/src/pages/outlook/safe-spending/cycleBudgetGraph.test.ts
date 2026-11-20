import { describe, expect, it } from "vitest";
import { buildCycleBudgetGraph } from "./cycleBudgetGraph.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

const production = {
	fundingRoom: 896.44,
	incomeFunded: 595.52,
	savingsAllowance: 95.52,
	savingsTarget: 500,
};

describe("cycle budget graph model", () => {
	it("splits cent-exact production amounts and labels the cushion boundary", () => {
		const graph = buildCycleBudgetGraph(production);
		expect(graph).not.toBeNull();
		expect(graph!.headline).toBe(896.44);
		expect(graph!.boundary).toBe(595.52);
		expect(
			graph!.segments.map((segment) => [segment.label, segment.amount]),
		).toEqual([
			[labels.afterSavingsGoal, 95.52],
			[labels.savingsGoalSetAside, 500],
			[labels.cashCushion, 300.92],
		]);
		const sum = graph!.segments.reduce(
			(total, segment) => total + segment.amount,
			0,
		);
		expect(Math.round(sum * 100)).toBe(
			Math.round(production.fundingRoom * 100),
		);
	});

	it("omits zero components but keeps a known boundary", () => {
		const graph = buildCycleBudgetGraph({
			...production,
			savingsAllowance: 595.52,
			savingsTarget: 0,
			fundingRoom: 895.52,
		});
		expect(graph!.segments.map((segment) => segment.label)).toEqual([
			labels.afterSavingsGoal,
			labels.cashCushion,
		]);

		const withoutCushion = buildCycleBudgetGraph({
			...production,
			fundingRoom: 595.52,
		});
		expect(withoutCushion!.segments.map((segment) => segment.label)).toEqual([
			labels.afterSavingsGoal,
			labels.savingsGoalSetAside,
		]);
	});

	it("withholds the graph for missing, shortfall, negative or inconsistent amounts", () => {
		expect(
			buildCycleBudgetGraph({ ...production, fundingRoom: null }),
		).toBeNull();
		expect(
			buildCycleBudgetGraph({ ...production, savingsAllowance: -610 }),
		).toBeNull();
		expect(
			buildCycleBudgetGraph({ ...production, fundingRoom: 500 }),
		).toBeNull();
		expect(
			buildCycleBudgetGraph({ ...production, savingsAllowance: 100 }),
		).toBeNull();
		expect(buildCycleBudgetGraph({ ...production, fundingRoom: 0 })).toBeNull();
	});
});
