import { describe, expect, it } from "vitest";
import { normalizeStochasticConfig } from "../";

describe("stochastic utilities", () => {
	it("normalizes run counts with simulation semantics", () => {
		expect(normalizeStochasticConfig({ runCount: 2.9, seed: 42 })).toEqual({
			runCount: 2,
			seed: 42,
		});
		expect(
			normalizeStochasticConfig({ runCount: 0, seed: null }).runCount,
		).toBe(1);
		expect(
			normalizeStochasticConfig({ runCount: 20_000, seed: null }).runCount,
		).toBe(10_000);
		expect(
			normalizeStochasticConfig({ runCount: Number.NaN, seed: null }).runCount,
		).toBe(1);
		expect(
			normalizeStochasticConfig({
				runCount: Number.POSITIVE_INFINITY,
				seed: null,
			}).runCount,
		).toBe(1);
	});
});
