import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { changesBetween, validatePlan } from "./model.ts";
import {
	removeEvaluation,
	removePlanItem,
	upsertItem,
} from "./accountEdits.ts";

describe("immutable plan edits", () => {
	it("preserves unchanged item order and reports exactly one toggle", () => {
		const before = JSON.stringify(financialModelFixture);
		const toggleEnabled = (enabled: boolean) => ({
			...financialModelFixture,
			transactions: financialModelFixture.transactions.map((item) =>
				item.id === "invest" ? { ...item, enabled } : item,
			),
		});
		const current = toggleEnabled(false);
		const changes = changesBetween({ saved: financialModelFixture, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Modified");
		expect(
			changesBetween({
				saved: financialModelFixture,
				current: toggleEnabled(true),
			}),
		).toEqual([]);
		expect(JSON.stringify(financialModelFixture)).toBe(before);
	});
	it("does not create phantom changes when replacing an unchanged item", () => {
		const item = financialModelFixture.accounts[0];
		if (!item) throw new Error("Missing test account");
		const current = {
			...financialModelFixture,
			accounts: upsertItem({
				items: financialModelFixture.accounts,
				item: { ...item },
			}),
		};
		expect(changesBetween({ saved: financialModelFixture, current })).toEqual(
			[],
		);
	});
	it("reports a pure reorder as a change so queue moves stage a draft", () => {
		const first = financialModelFixture.transactions[0];
		const second = financialModelFixture.transactions[1];
		if (!first || !second) throw new Error("Missing test transactions");
		const current = {
			...financialModelFixture,
			transactions: [
				second,
				first,
				...financialModelFixture.transactions.slice(2),
			],
		};
		const changes = changesBetween({ saved: financialModelFixture, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Modified");
	});
	it("reports exactly one removal and preserves all other records", () => {
		const current = removePlanItem({
			plan: financialModelFixture,
			target: { kind: "transactions", id: "invest", name: "Monthly investing" },
		});
		if (current instanceof Error) throw current;
		const changes = changesBetween({ saved: financialModelFixture, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Removed");
		expect(current.accounts).toBe(financialModelFixture.accounts);
	});
	it("rejects referenced and last-account deletions without mutating data", () => {
		const target = {
			kind: "accounts" as const,
			id: "checking",
			name: "Checking",
		};
		expect(
			removePlanItem({ plan: financialModelFixture, target }),
		).toBeInstanceOf(Error);
		const plan = {
			...financialModelFixture,
			accounts: financialModelFixture.accounts.slice(0, 1),
			transactions: [],
			evaluations: [],
		};
		expect(removePlanItem({ plan, target })).toBeInstanceOf(Error);
		expect(plan.accounts).toHaveLength(1);
	});
	it("accepts blank workspaces and the first account without weakening references", () => {
		const blank = {
			...financialModelFixture,
			accounts: [],
			transactions: [],
			evaluations: [],
		};
		expect(validatePlan(blank)).toEqual(blank);
		expect(
			validatePlan({
				...blank,
				accounts: financialModelFixture.accounts.slice(0, 1),
			}),
		).not.toBeInstanceOf(Error);
		expect(
			validatePlan({
				...blank,
				transactions: financialModelFixture.transactions,
			}),
		).toBeInstanceOf(Error);
	});
	it("isolates evaluation removal", () => {
		const evaluation = financialModelFixture.evaluations[0];
		if (!evaluation) throw new Error("Missing test evaluation");
		expect(
			changesBetween({
				saved: financialModelFixture,
				current: removeEvaluation({
					plan: financialModelFixture,
					id: evaluation.id,
				}),
			}),
		).toMatchObject([{ kind: "Removed", label: evaluation.name }]);
	});
});
