import { describe, expect, it } from "vitest";
import { testPlan as examplePlan } from "../../test/plan.ts";
import type { Movement, Plan } from "../model.ts";
import { analyzePay } from "./pay.ts";
import { toAnalysisResult } from "./runtime.ts";

function deposit(overrides: Partial<Movement> & { id: string }): Movement {
	return {
		name: "Pay deposit",
		amount: 5000,
		amountKnown: true,
		fromId: null,
		toId: "checking",
		frequency: "once",
		startDate: "2026-08-24",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimRuleId: null,
		claimOccurrenceDate: null,
		...overrides,
	};
}

function planWith(deposits: Movement[]): Plan {
	return { ...examplePlan, movements: deposits };
}

describe("toAnalysisResult", () => {
	it("reports ready when no warnings or errors exist", () => {
		const result = toAnalysisResult({ value: 1, diagnostics: [] });
		expect(result.state).toBe("ready");
	});
	it("reports warning when any warning exists", () => {
		const result = toAnalysisResult({
			value: 1,
			diagnostics: [{ code: "w", severity: "warning", message: "careful" }],
		});
		expect(result.state).toBe("warning");
	});
	it("reports error and drops the value when any error exists", () => {
		const result = toAnalysisResult({
			value: 1,
			diagnostics: [{ code: "e", severity: "error", message: "bad" }],
		});
		expect(result.state).toBe("error");
		expect(result.value).toBeNull();
	});
});

describe("analyzePay", () => {
	it("reports an error when no deposit records exist", () => {
		const result = analyzePay({ ...examplePlan, movements: [] });
		expect(result.state).toBe("error");
		expect(result.diagnostics[0]?.code).toBe("pay.no-records");
	});
	it("reads the household fixture as moderate monthly evidence", () => {
		const result = analyzePay(examplePlan);
		expect(result.state).toBe("warning");
		if (result.state === "error") throw new Error("Expected a value.");
		expect(result.value.monthly).toBe(true);
		expect(result.value.strength).toBe("moderate");
		expect(result.value.annualized).toBe(result.value.typical * 12);
	});
	it("reports strong monthly evidence with six comparable deposits", () => {
		const deposits = [24, 24, 24, 24, 24, 24].map((day, index) =>
			deposit({
				id: `pay-${index}`,
				startDate: `2026-0${3 + index}-${day}`,
				amount: 5000 + (index % 2),
			}),
		);
		const result = analyzePay(planWith(deposits));
		expect(result.state).toBe("ready");
		if (result.state !== "ready") throw new Error("Expected ready.");
		expect(result.value.monthly).toBe(true);
		expect(result.value.annualized).toBe(result.value.typical * 12);
		expect(result.value.strength).toBe("strong");
	});
	it("warns when cadence is unclear and withholds the annualized figure", () => {
		const deposits = [deposit({ id: "a" }), deposit({ id: "b" })];
		const result = analyzePay(planWith(deposits));
		expect(result.state).toBe("warning");
		if (result.state === "error") throw new Error("Expected a value.");
		expect(result.value.annualized).toBeNull();
		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.code === "pay.cadence-unclear",
			),
		).toBe(true);
	});
	it("excludes dissimilar and disabled records with reasons", () => {
		const deposits = [
			deposit({ id: "good" }),
			deposit({ id: "other", amount: 5100 }),
			deposit({ id: "outlier", amount: 9000 }),
			deposit({ id: "off", enabled: false }),
		];
		const result = analyzePay(planWith(deposits));
		if (result.state === "error") throw new Error("Expected a value.");
		expect(result.value.comparable.map((m) => m.id).sort()).toEqual([
			"good",
			"other",
		]);
		expect(result.value.excluded.map((m) => m.id).sort()).toEqual([
			"off",
			"outlier",
		]);
	});
});
