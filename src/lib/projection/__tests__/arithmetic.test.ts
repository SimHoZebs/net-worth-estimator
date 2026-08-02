import { describe, expect, it } from "vitest";
import {
	ArithmeticEvalError,
	evaluateArithmetic,
	parseArithmetic,
} from "../simulation/arithmetic";

const context = {
	postingAmounts: new Map<string, number>(),
	accountBalances: {},
	rate: 0,
};

describe("posting arithmetic", () => {
	it.each([
		["2 + 3 * 4", 14],
		["20 / 5 / 2", 2],
		["(2 + 3) * 4", 20],
		["abs(-3) + --2", 5],
	])("evaluates %s with standard precedence", (expression, expected) => {
		expect(evaluateArithmetic(expression, context)).toBe(expected);
	});

	it("resolves postings before accounts and supports rate", () => {
		const evaluationContext = {
			postingAmounts: new Map([
				["shared", 10],
				["prior", 4],
			]),
			accountBalances: { shared: 100, cash: 20 },
			rate: 0.5,
		};

		expect(
			evaluateArithmetic(
				"shared + prior + cash * rate + unknown",
				evaluationContext,
			),
		).toBe(24);
	});

	it.each(["1 2", "1)", "rate garbage"])(
		"rejects trailing input in %s",
		(expression) => {
			expect(() => parseArithmetic(expression)).toThrow(
				/Unexpected trailing input/,
			);
		},
	);

	it.each(["", "1 +", "abs(1", "(1 + 2", "1 @ 2"])(
		"rejects malformed expression %s",
		(expression) => {
			expect(() => parseArithmetic(expression)).toThrow();
		},
	);

	it("rejects division by zero during evaluation", () => {
		expect(() => evaluateArithmetic("10 / (2 - 2)", context)).toThrow(
			ArithmeticEvalError,
		);
	});
});
