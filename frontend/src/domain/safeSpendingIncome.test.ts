import { describe, expect, it } from "vitest";
import { testAccount } from "../mocks/account.ts";
import { transactionFixture } from "../mocks/projection.ts";
import type { Transaction, Plan } from "./model.ts";
import { safeSpendingIncome } from "./safeSpendingIncome.ts";

function rule(id: string, overrides: Partial<Transaction> = {}): Transaction {
	return {
		...testAccount.transactions[0]!,
		id,
		name: id,
		startDate: "2026-01-01",
		...overrides,
	};
}

function payment(transactionId: string, date: string, amount: number) {
	return transactionFixture({
		transactionId,
		date,
		requested: amount,
		realized: amount / 2,
		fromId: transactionId === "partner" ? "savings" : null,
		toId: "checking",
	});
}

const plan: Plan = {
	...testAccount,
	transactions: [
		rule("salary"),
		rule("partner", { fromId: "savings", readOnly: true, amountKnown: false }),
		rule("unselected"),
	],
};
const input = {
	plan,
	transactions: [
		payment("partner", "2026-11-20", 2400),
		payment("salary", "2026-10-15", 3000),
		payment("unselected", "2026-10-09", 9000),
		payment("partner", "2026-10-20", 2000),
		payment("salary", "2026-11-15", 3300),
	],
	incomeAccountIds: ["checking"],
	incomeRuleIds: ["salary", "partner"],
	todayIso: "2026-10-08",
};

describe("safeSpendingIncome", () => {
	it("adds the next projected payment from each selected source on different dates", () => {
		const result = safeSpendingIncome(input);
		expect(result.selectedRuleIds).toEqual(["salary", "partner"]);
		expect(result.paycheck).toEqual({
			date: "2026-10-15",
			endDate: "2026-10-20",
			amount: 5000,
		});
		expect(result.candidates[1]!.nextPayment).toEqual({
			date: "2026-10-20",
			amount: 2000,
		});
	});

	it("counts arbitrary selected transfer sources without an account-name convention", () => {
		expect(
			safeSpendingIncome({ ...input, incomeRuleIds: ["partner"] }).paycheck,
		).toEqual({ date: "2026-10-20", endDate: "2026-10-20", amount: 2000 });
	});

	it.each([{ ids: [] }, { ids: ["deleted"] }, { ids: ["unrelated-posting"] }])(
		"does not infer income for selection $ids",
		({ ids }) => {
			expect(
				safeSpendingIncome({ ...input, incomeRuleIds: ids }).paycheck,
			).toBeNull();
		},
	);

	it("counts same-day sources once and ignores repeated selected IDs", () => {
		expect(
			safeSpendingIncome({
				...input,
				incomeRuleIds: ["salary", "salary", "partner"],
				transactions: [
					payment("salary", "2026-10-15", 1000),
					payment("partner", "2026-10-15", 2000),
				],
			}).paycheck,
		).toEqual({ date: "2026-10-15", endDate: "2026-10-15", amount: 3000 });
	});

	it("sums event fragments on a rule's next payment date only", () => {
		expect(
			safeSpendingIncome({
				...input,
				incomeRuleIds: ["salary"],
				transactions: [
					payment("salary", "2026-10-15", 1000),
					payment("salary", "2026-11-15", 9000),
					payment("salary", "2026-10-15", 500),
				],
			}).paycheck?.amount,
		).toBe(1500);
	});

	it("exposes only enabled, current inflows into income accounts", () => {
		const rules = [
			rule("active"),
			rule("disabled", { enabled: false }),
			rule("expired", { endDate: "2026-10-07" }),
			rule("future", { startDate: "2026-10-09" }),
			rule("one-time", { frequency: "once" }),
			rule("expense", { fromId: "checking", toId: null }),
			rule("other-account", { toId: "brokerage" }),
			rule("starts-today", { startDate: "2026-10-08" }),
			rule("ends-today", { endDate: "2026-10-08" }),
		];
		const result = safeSpendingIncome({
			...input,
			plan: { ...plan, transactions: rules },
			incomeRuleIds: rules.map((item) => item.id),
			transactions: rules.map((item) => payment(item.id, "2026-10-15", 100)),
		});
		expect(result.selectedRuleIds).toEqual([
			"active",
			"starts-today",
			"ends-today",
		]);
		expect(result.candidates.map((item) => item.id)).toEqual(
			result.selectedRuleIds,
		);
		expect(result.paycheck?.amount).toBe(200);
	});

	it("scopes inflows to the selected income accounts, independent of spending", () => {
		const result = safeSpendingIncome({
			...input,
			incomeAccountIds: ["brokerage"],
		});
		expect(result.candidates).toEqual([]);
		expect(result.selectedRuleIds).toEqual([]);
		expect(result.paycheck).toBeNull();
	});

	it("ignores disabled and archived accounts and transfers within income accounts", () => {
		for (const accountPatch of [{ enabled: false }, { archived: true }]) {
			const result = safeSpendingIncome({
				...input,
				plan: {
					...plan,
					accounts: plan.accounts.map((account) => ({
						...account,
						...accountPatch,
					})),
				},
			});
			expect(result.candidates).toEqual([]);
			expect(result.paycheck).toBeNull();
		}
		const result = safeSpendingIncome({
			...input,
			incomeAccountIds: ["checking", "savings"],
		});
		expect(result.selectedRuleIds).toEqual(["salary"]);
		expect(result.paycheck?.amount).toBe(3000);
	});

	it("ignores stale IDs but retains valid sources", () => {
		expect(
			safeSpendingIncome({ ...input, incomeRuleIds: ["deleted", "salary"] })
				.selectedRuleIds,
		).toEqual(["salary"]);
	});

	it("ignores past, same-day, and nonpositive payments without using configured amounts", () => {
		const result = safeSpendingIncome({
			...input,
			transactions: [
				payment("salary", "2026-10-07", 10000),
				payment("salary", "2026-10-08", 10000),
				payment("salary", "2026-10-09", 0),
				payment("salary", "2026-10-10", -10),
				payment("salary", "2026-10-15", 125.5),
			],
		});
		expect(result.paycheck?.amount).toBe(125.5);
		expect(result.candidates[1]!.nextPayment).toBeNull();
	});

	it("keeps candidates but returns no income while projection data is absent", () => {
		const result = safeSpendingIncome({ ...input, transactions: [] });
		expect(result.candidates).toHaveLength(3);
		expect(result.paycheck).toBeNull();
	});
});
