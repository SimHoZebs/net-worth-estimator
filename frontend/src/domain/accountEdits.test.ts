import { describe, expect, it } from "vitest";
import { testAccount } from "../mocks/account.ts";
import { changesBetween, validatePlan } from "./model.ts";
import {
	removeEvaluation,
	removePlanItem,
	upsertItem,
} from "./accountEdits.ts";

describe("immutable plan edits", () => {
	it("preserves unchanged item order and reports exactly one toggle", () => {
		const before = JSON.stringify(testAccount);
		const toggleEnabled = (enabled: boolean) => ({
			...testAccount,
			transactions: testAccount.transactions.map((item) =>
				item.id === "invest" ? { ...item, enabled } : item,
			),
		});
		const current = toggleEnabled(false);
		const changes = changesBetween({ saved: testAccount, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Modified");
		expect(
			changesBetween({
				saved: testAccount,
				current: toggleEnabled(true),
			}),
		).toEqual([]);
		expect(JSON.stringify(testAccount)).toBe(before);
	});
	it("does not create phantom changes when replacing an unchanged item", () => {
		const item = testAccount.accounts[0];
		if (!item) throw new Error("Missing test account");
		const current = {
			...testAccount,
			accounts: upsertItem({ items: testAccount.accounts, item: { ...item } }),
		};
		expect(changesBetween({ saved: testAccount, current })).toEqual([]);
	});
	it("reports a pure reorder as a change so queue moves stage a draft", () => {
		const first = testAccount.transactions[0];
		const second = testAccount.transactions[1];
		if (!first || !second) throw new Error("Missing test transactions");
		const current = {
			...testAccount,
			transactions: [second, first, ...testAccount.transactions.slice(2)],
		};
		const changes = changesBetween({ saved: testAccount, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Modified");
	});
	it("reports exactly one removal and preserves all other records", () => {
		const current = removePlanItem({
			plan: testAccount,
			target: { kind: "transactions", id: "invest", name: "Monthly investing" },
		});
		if (current instanceof Error) throw current;
		const changes = changesBetween({ saved: testAccount, current });
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe("Removed");
		expect(current.accounts).toBe(testAccount.accounts);
	});
	it("rejects referenced and last-account deletions without mutating data", () => {
		const target = {
			kind: "accounts" as const,
			id: "checking",
			name: "Checking",
		};
		expect(removePlanItem({ plan: testAccount, target })).toBeInstanceOf(Error);
		const plan = {
			...testAccount,
			accounts: testAccount.accounts.slice(0, 1),
			transactions: [],
			evaluations: [],
		};
		expect(removePlanItem({ plan, target })).toBeInstanceOf(Error);
		expect(plan.accounts).toHaveLength(1);
	});
	it("accepts blank workspaces and the first account without weakening references", () => {
		const blank = {
			...testAccount,
			accounts: [],
			transactions: [],
			evaluations: [],
		};
		expect(validatePlan(blank)).toEqual(blank);
		expect(
			validatePlan({ ...blank, accounts: testAccount.accounts.slice(0, 1) }),
		).not.toBeInstanceOf(Error);
		expect(
			validatePlan({ ...blank, transactions: testAccount.transactions }),
		).toBeInstanceOf(Error);
	});
	it("isolates evaluation removal", () => {
		const evaluation = testAccount.evaluations[0];
		if (!evaluation) throw new Error("Missing test evaluation");
		expect(
			changesBetween({
				saved: testAccount,
				current: removeEvaluation({ plan: testAccount, id: evaluation.id }),
			}),
		).toMatchObject([{ kind: "Removed", label: evaluation.name }]);
	});
});
