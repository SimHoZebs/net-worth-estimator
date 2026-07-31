import { describe, expect, it } from "vitest";
import { makePosting } from "../__fixtures__/postings";
import {
	AmountResolutionError,
	createExpressionAmount,
	resolvePostingAmountDescriptor,
	updateExpressionAmount,
	validateAmountDescriptor,
} from "../simulation/amountResolution";
import { simulate } from "../simulation/simulate";
import { validateCsvFinancialModel } from "../sources/csv/csvValidation";
import type {
	FinancialModelDocument,
	PostingAmountResolution,
} from "../types/model";

const context = {
	balances: { checking: 500 },
	latestRealizedPostingAmounts: new Map([["salary", 100]]),
	realizedPostingAmountsByYear: new Map([["salary", new Map([["2026", 900]])]]),
	date: "2026-06-01",
	occurrenceRate: 0.01,
};

function resolve(amount: PostingAmountResolution) {
	return resolvePostingAmountDescriptor(amount, context);
}

const literal = (value: number) => ({ source: "literal" as const, value });

describe("posting amount resolution", () => {
	it("injects expression requirements without model lookup in the resolver", () => {
		const amount = createExpressionAmount("salary + checking * rate");
		expect(amount.inputs).toEqual({
			salary: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "salary" },
			},
			checking: {
				source: "provider",
				provider: "model-value",
				arguments: { id: "checking" },
			},
			rate: {
				source: "provider",
				provider: "occurrence-rate",
				arguments: {},
			},
		});
		expect(resolve(amount)).toBe(105);
	});

	it("rejects missing and extra expression inputs", () => {
		const missing = createExpressionAmount("salary + rate");
		delete missing.inputs.rate;
		expect(() => resolve(missing)).toThrow(AmountResolutionError);

		const extra = createExpressionAmount("salary");
		extra.inputs.other = literal(1);
		expect(() => resolve(extra)).toThrow(/Extra: other/);
	});

	it("preserves compatible provider bindings when editing an expression", () => {
		const amount = createExpressionAmount("salary");
		amount.inputs.salary = {
			source: "provider",
			provider: "posting-year-to-date",
			arguments: { id: "salary" },
		};

		expect(updateExpressionAmount(amount, "salary * 2").inputs.salary).toEqual(
			amount.inputs.salary,
		);
	});

	it("rejects nonnumeric literals during validation", () => {
		expect(() =>
			validateAmountDescriptor({
				resolver: "percentage",
				config: { rate: 0.1 },
				inputs: { amount: { source: "literal", value: "100" } },
			}),
		).toThrow(/must be a finite number/);
	});

	it("resolves percentage without rounding", () => {
		expect(
			resolve({
				resolver: "percentage",
				config: { rate: 0.125 },
				inputs: { amount: literal(10.5) },
			}),
		).toBe(1.3125);
		expect(
			resolve({
				resolver: "percentage",
				config: { rate: 0.5 },
				inputs: { amount: literal(-10) },
			}),
		).toBe(0);
	});

	it("uses progressive bracket widths at exact boundaries and subtracts prior liability", () => {
		const amount = (currentAmount: number, yearToDateAmount = 0, paid = 0) =>
			resolve({
				resolver: "progressive-bracket",
				config: {
					deduction: 100,
					brackets: [
						{ upTo: 1_000, rate: 0.1 },
						{ upTo: 2_000, rate: 0.2 },
						{ upTo: null, rate: 0.3 },
					],
				},
				inputs: {
					currentAmount: literal(currentAmount),
					yearToDateAmount: literal(yearToDateAmount),
					yearToDateResolvedAmount: literal(paid),
				},
			});

		expect(amount(1_100)).toBe(100); // Taxable amount is exactly the first upper bound.
		expect(amount(1_101)).toBeCloseTo(100.2);
		expect(amount(500, 1_600, 280)).toBe(20);
	});

	it("applies capped and threshold percentages incrementally", () => {
		expect(
			resolve({
				resolver: "capped-percentage",
				config: { rate: 0.5, cap: 1_000 },
				inputs: {
					currentAmount: literal(300),
					yearToDateAmount: literal(900),
				},
			}),
		).toBe(50);
		expect(
			resolve({
				resolver: "threshold-percentage",
				config: { rate: 0.2, threshold: 1_000 },
				inputs: {
					currentAmount: literal(300),
					yearToDateAmount: literal(900),
				},
			}),
		).toBe(40);
	});

	it("provides current and prior year-to-date posting values separately", () => {
		const providerInput = (provider: string) => ({
			resolver: "percentage",
			config: { rate: 1 },
			inputs: {
				amount: {
					source: "provider" as const,
					provider,
					arguments: { id: "salary" },
				},
			},
		});

		expect(resolve(providerInput("posting-year-to-date"))).toBe(900);
		expect(resolve(providerInput("posting-prior-year-to-date"))).toBe(800);
	});

	it("does not double count the current source occurrence in a threshold resolver", () => {
		const salary = makePosting({
			id: "salary",
			destinations: ["cash"],
			arithmetic: "100",
			startDate: "2026-01-01",
			priority: 1,
		});
		const tax = makePosting({
			id: "tax",
			sourceAccountId: "cash",
			amount: {
				resolver: "threshold-percentage",
				config: { rate: 0.1, threshold: 100 },
				inputs: {
					currentAmount: {
						source: "provider",
						provider: "posting-latest",
						arguments: { id: "salary" },
					},
					yearToDateAmount: {
						source: "provider",
						provider: "posting-prior-year-to-date",
						arguments: { id: "salary" },
					},
				},
			},
			startDate: "2026-01-01",
			priority: 2,
		});
		const run = simulate({
			model: {
				accounts: [
					{
						id: "cash",
						label: "Cash",
						minBalance: 0,
						maxBalance: Number.POSITIVE_INFINITY,
						color: null,
						enabled: true,
					},
				],
				postings: [salary, tax],
			},
			initialState: {
				balances: { cash: 0 },
				latestRealizedPostingAmounts: new Map(),
				realizedPostingAmountsByYear: new Map(),
			},
			startDate: "2026-01-01",
			endDate: "2026-02-01",
			includeStartDateEvents: true,
		});

		expect(
			run.movementAttempts
				.filter((event) => event.origin.postingId === "tax")
				.map((event) => event.requestedAmount),
		).toEqual([0, 10]);
	});

	it("validates provider arguments and references", () => {
		const references = {
			accountIds: new Set(["checking"]),
			postingIds: new Set(["salary"]),
		};
		expect(() =>
			validateAmountDescriptor(createExpressionAmount("missing"), references),
		).toThrow(/not a posting or account/);
		expect(() =>
			validateAmountDescriptor(
				{
					resolver: "percentage",
					config: { rate: 0.1 },
					inputs: {
						amount: {
							source: "provider",
							provider: "account-balance",
							arguments: { id: "checking", extra: true },
						},
					},
				},
				references,
			),
		).toThrow(/Unrecognized key/);
	});

	it("detects cycles on every provider edge and rejects non-expression rates", () => {
		const document: FinancialModelDocument = {
			sourcePath: "test",
			accounts: [],
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
			postings: [
				makePosting({ id: "a", arithmetic: "leaf + b" }),
				makePosting({ id: "b", arithmetic: "a" }),
				makePosting({ id: "leaf", arithmetic: "1" }),
				makePosting({
					id: "percentage",
					amount: {
						resolver: "percentage",
						config: { rate: 0.1 },
						inputs: { amount: literal(100) },
					},
					annualGrowthRate: 0.01,
				}),
			],
		};
		const issues = validateCsvFinancialModel(document);
		expect(
			issues.some((issue) => issue.code === "posting.amount.circular"),
		).toBe(true);
		expect(
			issues.some(
				(issue) => issue.code === "posting.amount.non_expression_rates",
			),
		).toBe(true);
	});

	it("allows a resolver to read its own historical year-to-date total", () => {
		const document: FinancialModelDocument = {
			sourcePath: "test",
			accounts: [
				{
					id: "cash",
					label: "Cash",
					minBalance: 0,
					maxBalance: 1_000,
					color: null,
					enabled: true,
				},
			],
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
			postings: [
				makePosting({
					id: "tax",
					destinations: ["cash"],
					amount: {
						resolver: "progressive-bracket",
						config: {
							deduction: 0,
							brackets: [{ upTo: null, rate: 0.1 }],
						},
						inputs: {
							currentAmount: literal(100),
							yearToDateAmount: literal(900),
							yearToDateResolvedAmount: {
								source: "provider",
								provider: "posting-year-to-date",
								arguments: { id: "tax" },
							},
						},
					},
				}),
			],
		};

		expect(
			validateCsvFinancialModel(document).filter(
				(issue) => issue.severity === "error",
			),
		).toEqual([]);
	});
});
