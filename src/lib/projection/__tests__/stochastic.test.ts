import { describe, expect, it } from "vitest";
import {
	computePercentiles,
	createStochasticSampler,
	normalizeStochasticConfig,
	reseed,
	sampleLogNormal,
} from "../";

describe("stochastic utilities", () => {
	it("computes correct percentiles", () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const percentiles = computePercentiles(values);

		expect(percentiles.p10).toBe(1.9);
		expect(percentiles.p25).toBe(3.25);
		expect(percentiles.p50).toBe(5.5);
		expect(percentiles.p75).toBe(7.75);
		expect(percentiles.p90).toBe(9.1);
	});

	it("handles empty percentile input", () => {
		const percentiles = computePercentiles([]);

		expect(percentiles.p10).toBe(0);
		expect(percentiles.p50).toBe(0);
	});

	it("returns expected return when volatility is zero", () => {
		expect(sampleLogNormal(0.07, 0)).toBe(0.07);
	});

	it("is deterministic with a seed", () => {
		reseed(42);
		const first = sampleLogNormal(0.07, 0.15);
		reseed(42);
		const second = sampleLogNormal(0.07, 0.15);

		expect(first).toBe(second);
		expect(first).toBe(0.14432693544999387);
		expect(first).not.toBe(0.07);
	});

	it("keeps seeded samplers independent when draws are interleaved", () => {
		const baseline = createStochasticSampler(42);
		const expected = [baseline(0.07, 0.15), baseline(0.07, 0.15)];
		const sampler = createStochasticSampler(42);
		const otherSampler = createStochasticSampler(7);

		const actual = [sampler(0.07, 0.15)];
		otherSampler(0.07, 0.15);
		actual.push(sampler(0.07, 0.15));

		expect(actual).toEqual(expected);
	});

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

	it("produces different draws without seed", () => {
		reseed(null);
		const first = sampleLogNormal(0.07, 0.15);
		const second = sampleLogNormal(0.07, 0.15);

		expect(first).not.toBe(second);
	});
});
