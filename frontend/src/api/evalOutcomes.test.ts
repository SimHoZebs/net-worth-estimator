import { describe, expect, it } from "vitest";
import {
	OTHER_EVAL_OUTCOME_RENDERERS,
	balanceEvaluation,
	bandsOf,
	cycleOutcome,
	numericValueOf,
	transactionOutcome,
	thresholdEvaluation,
} from "./evalOutcomes.ts";
import type { EvaluationResultEnvelope } from "./contracts.ts";

function envelope(
	overrides: Partial<EvaluationResultEnvelope> = {},
): EvaluationResultEnvelope {
	return {
		instanceId: "e1",
		name: "E1",
		status: "satisfied",
		deterministic: null,
		probabilistic: null,
		diagnostics: [],
		...overrides,
	};
}

describe("eval outcome renderers", () => {
	it("keeps threshold and balance mapping identical", () => {
		const evaluation = {
			instanceId: "t",
			name: "Target",
			enabled: true,
			config: { target: 500 },
		};
		expect(thresholdEvaluation(evaluation, envelope(), 60, 160)).toMatchObject({
			evaluation: { id: "t", kind: "net-worth", target: 500, accountId: null },
			firstDate: null,
			current: 60,
			final: 160,
		});
		const balances = new Map([
			["cash", { startingBalance: 100, endingBalance: 200 }],
		]);
		expect(
			balanceEvaluation(
				{ ...evaluation, config: { target: 300, accountId: "cash" } },
				envelope(),
				balances as never,
			),
		).toMatchObject({
			evaluation: { kind: "reserve", accountId: "cash" },
			current: 100,
			final: 200,
		});
	});

	it("keeps transaction and cycle outcomes identical", () => {
		expect(transactionOutcome(null).outcomeText).toBe(
			"No projected funding gaps",
		);
		expect(
			transactionOutcome({ firstUnderfulfilledDate: "2026-03-01" }).outcomeText,
		).toBe("Shortfall");
		expect(cycleOutcome({ withinBudget: true }).outcomeText).toBe(
			"Within budget",
		);
		expect(cycleOutcome({ withinBudget: false }).outcomeText).toBe(
			"Over budget",
		);
	});

	it("extracts numeric values and bands without changing status", () => {
		expect(numericValueOf(envelope())).toBeNull();
		expect(bandsOf(envelope())).toBeNull();
		const valued = envelope({
			deterministic: { value: 3, unit: "currency" },
			probabilistic: { bands: { p10: 1, p50: 2, p90: 4 } },
		});
		expect(numericValueOf(valued)).toEqual({ current: 3, unit: "currency" });
		expect(bandsOf(valued)).toEqual({ p10: 1, p50: 2, p90: 4 });
		const flat = envelope({ probabilistic: { p10: 1, p50: 2, p90: 3 } });
		expect(bandsOf(flat)).toEqual({ p10: 1, p50: 2, p90: 3 });
	});

	it("routes every other-eval type through the registry with reader support", () => {
		const transaction = OTHER_EVAL_OUTCOME_RENDERERS.transactionFulfillment(
			{ instanceId: "p", name: "Bills", enabled: true, config: {} },
			{ envelope: undefined, transactionIds: null, enabled: true },
		);
		expect(transaction).toMatchObject({
			type: "transactionFulfillment",
			status: "indeterminate",
			outcomeText: "No projected funding gaps",
		});
		const cycle = OTHER_EVAL_OUTCOME_RENDERERS.cycleFulfillment(
			{ instanceId: "c", name: "", enabled: true, config: {} },
			{
				envelope: envelope({ status: "not-satisfied" }),
				transactionIds: null,
				enabled: true,
			},
		);
		expect(cycle).toMatchObject({
			type: "cycleFulfillment",
			status: "not-satisfied",
		});
	});
});
