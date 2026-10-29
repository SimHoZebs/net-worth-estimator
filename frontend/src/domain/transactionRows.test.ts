import { describe, expect, it } from "vitest";
import {
	growthPercentOf,
	literalAmountOf,
	transactionToPlan,
} from "./transactionRows.ts";

describe("transaction rows", () => {
	it("reads literal and calculated amounts", () => {
		expect(
			literalAmountOf({
				resolver: "expression",
				config: { expression: "200" },
				inputs: {},
			}),
		).toBe(200);
		expect(
			literalAmountOf({
				resolver: "expression",
				config: { expression: "(500) * growth" },
				inputs: {
					growth: {
						source: "provider",
						provider: "growth-factor",
						arguments: { annualGrowthRate: 0.03 },
					},
				},
			}),
		).toBeNull();
		expect(
			literalAmountOf({
				resolver: "other",
				config: { value: 42 },
				inputs: {},
			}),
		).toBe(42);
		expect(
			growthPercentOf({
				resolver: "expression",
				config: { expression: "(500) * growth" },
				inputs: {
					growth: {
						source: "provider",
						provider: "growth-factor",
						arguments: { annualGrowthRate: 0.03 },
					},
				},
			}),
		).toBeCloseTo(3, 10);
		expect(
			growthPercentOf({
				resolver: "expression",
				config: { expression: "200" },
				inputs: {},
			}),
		).toBe(0);
	});

	it("maps narrow rows to display transactions", () => {
		const rule = transactionToPlan(
			{
				id: "salary",
				kind: "rule",
				name: "Salary",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: {
					resolver: "expression",
					config: { expression: "(500) * growth" },
					inputs: {
						growth: {
							source: "provider",
							provider: "growth-factor",
							arguments: { annualGrowthRate: 0.03 },
						},
					},
				},
				frequency: "monthly",
				startDate: "2026-02-01",
				endDate: null,
				enabled: true,
				syncOwned: false,
				readOnly: false,
			},
			{ requested: 515 },
		);
		expect(rule).toMatchObject({
			id: "salary",
			amount: 515,
			amountKnown: true,
			fromId: null,
			toId: "cash",
			frequency: "monthly",
			annualIncrease: 3,
			postedDate: null,
			pending: false,
			void: false,
		});
		const posting = transactionToPlan({
			id: "once-1",
			kind: "posting",
			name: "Groceries",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "200" },
				inputs: {},
			},
			frequency: "once",
			startDate: "2026-02-15",
			endDate: null,
			enabled: true,
			syncOwned: false,
			readOnly: false,
		} as never);
		expect(posting).toMatchObject({
			frequency: "once",
			amount: 200,
			amountKnown: true,
			annualIncrease: 0,
		});
		const varied = transactionToPlan(
			{
				id: "varied",
				kind: "rule",
				name: "Varied",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: { resolver: "other", config: {}, inputs: {} },
				frequency: "annual",
				startDate: "2026-02-01",
				endDate: null,
				enabled: true,
				syncOwned: false,
				readOnly: false,
			},
			null,
		);
		expect(varied).toMatchObject({
			amount: 0,
			amountKnown: false,
			frequency: "yearly",
		});
		const bankRow = transactionToPlan({
			id: "void-1",
			kind: "posting",
			name: "Vanished auth",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "42.10" },
				inputs: {},
			},
			frequency: "once",
			startDate: "2026-02-15",
			endDate: null,
			enabled: false,
			syncOwned: true,
			readOnly: true,
			pending: false,
			void: true,
		} as never);
		expect(bankRow).toMatchObject({ pending: false, void: true });
	});
});
