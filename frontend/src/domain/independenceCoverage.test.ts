import { describe, expect, it } from "vitest";
import { independenceCoveragePoints } from "./independenceCoverage.ts";

function candidate(
	date: string,
	overrides: Partial<{
		coverage: number | null;
		annualIncome: number | null;
		annualSpending: number | null;
	}> = {},
) {
	return {
		date,
		coverage: 0.5,
		annualIncome: 40_000,
		annualSpending: 80_000,
		...overrides,
	};
}

describe("independence coverage points", () => {
	it("keeps absent evidence null so line and area marks break", () => {
		const points = independenceCoveragePoints([
			candidate("2026-02-01"),
			candidate("2030-02-01", {
				coverage: null,
				annualIncome: null,
				annualSpending: null,
			}),
			candidate("2036-02-01"),
		]);
		expect(points.map((point) => point.coverage)).toEqual([0.5, null, 0.5]);
		expect(points.map((point) => point.income)).toEqual([0.5, null, 0.5]);
	});

	it("clamps negative ratios to the zero floor", () => {
		const [point] = independenceCoveragePoints([
			candidate("2026-02-01", { coverage: -0.2, annualIncome: -1000 }),
		]);
		expect(point).toMatchObject({ coverage: 0, income: 0 });
	});

	it("rejects a zero spending denominator", () => {
		const [point] = independenceCoveragePoints([
			candidate("2026-02-01", { annualSpending: 0 }),
		]);
		expect(point).toMatchObject({ coverage: null, income: null });
	});
});
