import { describe, expect, it } from "vitest";
import { testPlan } from "../test/plan.ts";
import { changesBetween } from "./model.ts";
import {
	removeGoal,
	removePlanItem,
	setGoalEnabled,
	toggleMovement,
	upsertItem,
} from "./planEdits.ts";

describe("immutable plan edits", () => {
	it("preserves unchanged item order and reports exactly one toggle", () => {
		const before = JSON.stringify(testPlan);
		const current = toggleMovement({ plan: testPlan, id: "invest" });
		expect(changesBetween({ saved: testPlan, current })).toMatchObject([
			{ kind: "Modified", label: "Monthly investing" },
		]);
		expect(
			changesBetween({
				saved: testPlan,
				current: toggleMovement({ plan: current, id: "invest" }),
			}),
		).toEqual([]);
		expect(JSON.stringify(testPlan)).toBe(before);
	});
	it("does not create phantom changes when replacing an unchanged item", () => {
		const item = testPlan.accounts[0];
		if (!item) throw new Error("Missing test account");
		const current = {
			...testPlan,
			accounts: upsertItem({ items: testPlan.accounts, item: { ...item } }),
		};
		expect(changesBetween({ saved: testPlan, current })).toEqual([]);
	});
	it("reports exactly one removal and preserves all other records", () => {
		const current = removePlanItem({
			plan: testPlan,
			target: { kind: "movements", id: "invest", name: "Monthly investing" },
		});
		if (current instanceof Error) throw current;
		expect(changesBetween({ saved: testPlan, current })).toMatchObject([
			{ kind: "Removed", label: "Monthly investing" },
		]);
		expect(current.accounts).toBe(testPlan.accounts);
	});
	it("rejects referenced and last-account deletions without mutating data", () => {
		const target = {
			kind: "accounts" as const,
			id: "checking",
			name: "Checking",
		};
		expect(removePlanItem({ plan: testPlan, target })).toBeInstanceOf(Error);
		const plan = {
			...testPlan,
			accounts: testPlan.accounts.slice(0, 1),
			movements: [],
			goals: [],
		};
		expect(removePlanItem({ plan, target })).toBeInstanceOf(Error);
		expect(plan.accounts).toHaveLength(1);
	});
	it("isolates goal toggles and removal", () => {
		const goal = testPlan.goals[0];
		if (!goal) throw new Error("Missing test goal");
		expect(
			changesBetween({
				saved: testPlan,
				current: setGoalEnabled({
					plan: testPlan,
					id: goal.id,
					enabled: !goal.enabled,
				}),
			}),
		).toHaveLength(1);
		expect(
			changesBetween({
				saved: testPlan,
				current: removeGoal({ plan: testPlan, id: goal.id }),
			}),
		).toMatchObject([{ kind: "Removed", label: goal.name }]);
	});
});
