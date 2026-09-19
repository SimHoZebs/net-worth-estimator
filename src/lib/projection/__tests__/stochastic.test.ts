import { describe, expect, it } from "vitest";
import { normalizeStochasticConfig } from "../";
import { createBaseDocument, makeSettings } from "../__fixtures__";
import { deriveStochasticSeed } from "../utils/stochastic";

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

	describe("deriveStochasticSeed", () => {
		const base = () => ({
			document: createBaseDocument(),
			settings: makeSettings(),
			runCount: 1000,
		});

		it("is deterministic for identical inputs", () => {
			expect(deriveStochasticSeed(base())).toBe(deriveStochasticSeed(base()));
		});

		it("yields a 31-bit non-negative integer", () => {
			const seed = deriveStochasticSeed(base());
			expect(Number.isInteger(seed)).toBe(true);
			expect(seed).toBeGreaterThanOrEqual(0);
			expect(seed).toBeLessThanOrEqual(0x7fffffff);
		});

		it("changes when the model, horizon, or run count changes", () => {
			const reference = deriveStochasticSeed(base());
			const document = createBaseDocument();
			const firstPosting = document.postings[0];
			if (!firstPosting) throw new Error("Fixture needs a posting.");
			const changedDoc = {
				...base(),
				document: {
					...document,
					postings: [...document.postings, { ...firstPosting, id: "extra" }],
				},
			};
			expect(deriveStochasticSeed(changedDoc)).not.toBe(reference);
			expect(
				deriveStochasticSeed({
					...base(),
					settings: { ...makeSettings(), horizonYears: 30 },
				}),
			).not.toBe(reference);
			expect(deriveStochasticSeed({ ...base(), runCount: 500 })).not.toBe(
				reference,
			);
		});

		it("ignores evaluation labels", () => {
			const reference = deriveStochasticSeed(base());
			const settings = makeSettings();
			const [first, ...rest] = settings.evaluations.financialIndependence;
			const relabeled = {
				...base(),
				settings: {
					...settings,
					evaluations: {
						...settings.evaluations,
						financialIndependence: [{ ...first, label: "Renamed" }, ...rest],
					},
				},
			};
			expect(deriveStochasticSeed(relabeled)).toBe(reference);
		});
	});
});
