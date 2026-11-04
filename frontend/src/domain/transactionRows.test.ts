import { describe, expect, it } from "vitest";
import {
	growthPercentOf,
	literalAmountOf,
	transactionToDisplay,
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
		const rule = transactionToDisplay(
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
			kind: "rule",
			annualIncrease: 3,
			postedDate: null,
			pending: false,
			void: false,
		});
		const posting = transactionToDisplay({
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
			startDate: "2026-02-15",
			endDate: null,
			enabled: true,
			syncOwned: false,
			readOnly: false,
		} as never);
		expect(posting).toMatchObject({
			kind: "posting",
			amount: 200,
			amountKnown: true,
			annualIncrease: 0,
		});
		const varied = transactionToDisplay(
			{
				id: "varied",
				kind: "rule",
				name: "Varied",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: { resolver: "other", config: {}, inputs: {} },
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
			kind: "rule",
		});
		const bankRow = transactionToDisplay({
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
			startDate: "2026-02-15",
			endDate: null,
			enabled: false,
			syncOwned: true,
			readOnly: true,
			pending: false,
			void: true,
			postedTime: 1785817200,
			transactionTime: 1785800000,
		} as never);
		expect(bankRow).toMatchObject({ pending: false, void: true });
		// A vanished hold never posted: even a legacy fabricated posted
		// instant must not surface as a posted date.
		expect(bankRow.postedDate).toBeNull();
		const pendingRow = transactionToDisplay({
			id: "pending-1",
			kind: "posting",
			name: "Live auth",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "18.50" },
				inputs: {},
			},
			startDate: "2026-02-16",
			endDate: null,
			enabled: false,
			syncOwned: true,
			readOnly: true,
			pending: true,
			transactionTime: 1785800000,
		} as never);
		expect(pendingRow).toMatchObject({
			pending: true,
			void: false,
			postedDate: null,
		});
	});
});
