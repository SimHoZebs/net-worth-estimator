import { describe, expect, it } from "vitest";
import { examplePlan } from "./example.ts";
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
		const before = JSON.stringify(examplePlan);
		const current = toggleMovement({ plan: examplePlan, id: "invest" });
		expect(changesBetween({ saved: examplePlan, current })).toMatchObject([
			{ kind: "Modified", label: "Monthly investing" },
		]);
		expect(
			changesBetween({
				saved: examplePlan,
				current: toggleMovement({ plan: current, id: "invest" }),
			}),
		).toEqual([]);
		expect(JSON.stringify(examplePlan)).toBe(before);
	});
	it("does not create phantom changes when replacing an unchanged item", () => {
		const item = examplePlan.accounts[0];
		if (!item) throw new Error("Missing test account");
		const current = {
			...examplePlan,
			accounts: upsertItem({ items: examplePlan.accounts, item: { ...item } }),
		};
		expect(changesBetween({ saved: examplePlan, current })).toEqual([]);
	});
	it("reports exactly one removal and preserves all other records", () => {
		const current = removePlanItem({
			plan: examplePlan,
			target: { kind: "movements", id: "invest", name: "Monthly investing" },
		});
		if (current instanceof Error) throw current;
		expect(changesBetween({ saved: examplePlan, current })).toMatchObject([
			{ kind: "Removed", label: "Monthly investing" },
		]);
		expect(current.accounts).toBe(examplePlan.accounts);
	});
	it("rejects referenced and last-account deletions without mutating data", () => {
		const target = {
			kind: "accounts" as const,
			id: "checking",
			name: "Checking",
		};
		expect(removePlanItem({ plan: examplePlan, target })).toBeInstanceOf(Error);
		const plan = {
			...examplePlan,
			accounts: examplePlan.accounts.slice(0, 1),
			movements: [],
			goals: [],
		};
		expect(removePlanItem({ plan, target })).toBeInstanceOf(Error);
		expect(plan.accounts).toHaveLength(1);
	});
	it("isolates goal toggles and removal", () => {
		const goal = examplePlan.goals[0];
		if (!goal) throw new Error("Missing test goal");
		expect(
			changesBetween({
				saved: examplePlan,
				current: setGoalEnabled({
					plan: examplePlan,
					id: goal.id,
					enabled: !goal.enabled,
				}),
			}),
		).toHaveLength(1);
		expect(
			changesBetween({
				saved: examplePlan,
				current: removeGoal({ plan: examplePlan, id: goal.id }),
			}),
		).toMatchObject([{ kind: "Removed", label: goal.name }]);
	});
});
