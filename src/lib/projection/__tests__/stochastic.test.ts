import { describe, expect, it } from "vitest";
import {
	computePercentiles,
	createStochasticSampler,
	getFinancialIndependenceResult,
	getNetWorthThresholdResult,
	normalizeStochasticConfig,
	parseCsvFinancialModel,
	projectFinancialModelDocument,
	reseed,
	sampleLogNormal,
	stochasticProject,
} from "../";
import { makePosting, makeSettings, validCsvFiles } from "../__fixtures__";
import { buildSampleCountsByPostingId } from "../analysis/projectStochastic";
import type {
	FinancialIndependencePlan,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { StochasticProjectionResult } from "../types/stochastic";

function withFiPlan(
	overrides: Partial<ProjectionRuntimeSettings>,
	plan: FinancialIndependencePlan,
) {
	const settings = makeSettings(overrides);
	return {
		...settings,
		evaluations: {
			...settings.evaluations,
			financialIndependence: settings.evaluations.financialIndependence.map(
				(evaluation) => ({ ...evaluation, config: plan }),
			),
		},
	};
}

function fiResult(result: StochasticProjectionResult) {
	return getFinancialIndependenceResult(result)?.probabilistic;
}

function thresholdProbability(result: StochasticProjectionResult) {
	return getNetWorthThresholdResult(result)?.probabilistic?.probability ?? 0;
}

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

describe("stochastic projection", () => {
	it("adds a terminal-year draw only for postings that need it", () => {
		const regular = makePosting({
			id: "regular",
			volatility: 0.2,
			startDate: "2026-06-01",
			endDate: "2026-06-01",
		});
		const terminal = makePosting({
			id: "terminal",
			volatility: 0.2,
			frequency: "annual",
			startDate: "2027-01-01",
			endDate: "2027-01-01",
		});

		const counts = buildSampleCountsByPostingId(
			[regular, terminal],
			1,
			"2026-01-01",
			"2027-01-01",
			true,
		);

		expect(counts).toEqual(
			new Map([
				["regular", 1],
				["terminal", 2],
			]),
		);
	});

	it("samples a volatile posting on the inclusive projection end date", () => {
		const document = {
			...parseCsvFinancialModel(validCsvFiles).data!,
			accounts: [
				{
					id: "checking",
					label: "Checking",
					minBalance: 0,
					maxBalance: Number.POSITIVE_INFINITY,
					color: null,
					enabled: true,
				},
			],
			postings: [
				{
					id: "terminal-growth",
					label: "Terminal growth",
					sourceAccountId: null,
					destinations: ["checking"],
					arithmetic: "100 * rate",
					frequency: "annual" as const,
					annualRate: 0.1,
					annualGrowthRate: 0,
					volatility: 0.5,
					startDate: "2027-01-01",
					endDate: "2027-01-01",
					annualCap: null,
					priority: 1,
					enabled: true,
				},
			],
		};
		const result = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-01-01",
				horizonYears: 1,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);
		const terminal = result.bands.find((row) => row.date === "2027-01-01");

		expect(terminal?.netWorth.p10).not.toBe(terminal?.netWorth.p90);
	});

	it("normalizes invalid run counts before simulation", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");

		const fractional = stochasticProject(
			document,
			makeSettings(),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 2.9, seed: 1 },
		);
		const nonPositive = stochasticProject(
			document,
			makeSettings(),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 0, seed: 1 },
		);

		expect(fractional.config.runCount).toBe(2);
		expect(nonPositive.config.runCount).toBe(1);
	});

	it("aggregates FI-cycle outcomes from complete seeded runs", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		const partials: StochasticProjectionResult[] = [];
		const result = stochasticProject(
			document,
			withFiPlan(
				{
					fallbackProjectionStartDate: "2026-04-01",
					horizonYears: 2,
				},
				{
					minimumNetWorth: 0,
					annualExpenseTarget: 1_000,
					annualExpenseGrowthRate: 0,
					withdrawalRate: 0.04,
					evaluationYears: 1,
					requiredConfidence: 0.9,
					principalPolicy: "allow-drawdown",
					sources: [{ type: "cashflow", postingId: "salary", included: true }],
					continuingPostingIds: [],
				},
			),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 50, seed: 42 },
			(_progress, partial) => partials.push(partial),
		);

		expect(fiResult(result)?.fiCycleSuccessProbability).toBe(1);
		expect(fiResult(result)?.medianCoverageDate).not.toBeNull();
		expect(fiResult(result)?.selfSustainingDate).not.toBeNull();
		expect(
			fiResult(partials[partials.length - 1])?.fiCycleSuccessProbability,
		).toBe(1);
	});

	it("counts candidates below the semantic net-worth gate as failures", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		const result = stochasticProject(
			document,
			withFiPlan(
				{
					fallbackProjectionStartDate: "2026-04-01",
					horizonYears: 2,
				},
				{
					minimumNetWorth: 1_000_000_000,
					annualExpenseTarget: 1_000,
					annualExpenseGrowthRate: 0,
					withdrawalRate: 0.04,
					evaluationYears: 1,
					requiredConfidence: 0.9,
					principalPolicy: "allow-drawdown",
					sources: [{ type: "cashflow", postingId: "salary", included: true }],
					continuingPostingIds: [],
				},
			),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 50, seed: 42 },
		);

		expect(fiResult(result)?.medianCoverageDate).not.toBeNull();
		expect(fiResult(result)?.fiCycleSuccessProbability).toBe(0);
		expect(fiResult(result)?.selfSustainingDate).toBeNull();
		expect(fiResult(result)?.candidateWithdrawalDiagnostics[0]).toMatchObject({
			totalRunCount: 50,
			diagnosticRunCount: 0,
			shortfallRunCount: 0,
			shortfallProbability: 0,
		});
	});

	it("returns deterministic baseline alongside stochastic bands", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const result = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);

		expect(result.deterministic).toBeDefined();
		expect(result.bands.length).toBeGreaterThan(0);
		expect(result.config.runCount).toBe(100);
		expect(thresholdProbability(result)).toBeGreaterThanOrEqual(0);
		expect(thresholdProbability(result)).toBeLessThanOrEqual(1);
	});

	it("generates same bands with same seed", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const result1 = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);

		const result2 = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);

		expect(result1.bands.length).toBe(result2.bands.length);
		expect(result1.bands[0].netWorth.p50).toBe(result2.bands[0].netWorth.p50);
		expect(thresholdProbability(result1)).toBe(thresholdProbability(result2));
	});

	it("works without onProgress callback (backward compatible)", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const result = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 5,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 50, seed: 42 },
		);

		expect(result.bands.length).toBeGreaterThan(0);
		expect(thresholdProbability(result)).toBeGreaterThanOrEqual(0);
	});

	it("returns P50 close to deterministic when volatility is zero", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const deterministicOnlyDocument = {
			...document,
			postings: document.postings.map((p) => ({ ...p, volatility: 0 })),
		};

		const result = stochasticProject(
			deterministicOnlyDocument,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);

		const deterministic = projectFinancialModelDocument(
			deterministicOnlyDocument,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
		);

		expect(result.bands[result.bands.length - 1].netWorth.p50).toBe(
			deterministic.timeline.rows[deterministic.timeline.rows.length - 1]
				.netWorth,
		);
	});
});

describe("stochastic progress streaming", () => {
	it("reports progress with ascending values and reaches 1.0", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const progressValues: number[] = [];
		stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 250, seed: 42 },
			(p) => progressValues.push(p),
		);

		expect(progressValues.length).toBeGreaterThan(1);
		expect(progressValues[0]).toBeLessThan(1);
		expect(progressValues[progressValues.length - 1]).toBe(1);

		for (let i = 1; i < progressValues.length; i++) {
			expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
		}
	});

	it("produces identical results with and without onProgress", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const resultWithout = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
		);

		const resultWith = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 100, seed: 42 },
			() => {},
		);

		expect(resultWith.bands.length).toBe(resultWithout.bands.length);
		expect(resultWith.bands[0].netWorth.p50).toBe(
			resultWithout.bands[0].netWorth.p50,
		);
		expect(thresholdProbability(resultWith)).toBe(
			thresholdProbability(resultWithout),
		);
	});

	it("reports progress for a small run count (1)", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const progressValues: number[] = [];
		stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 5,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 1, seed: 42 },
			(p) => progressValues.push(p),
		);

		expect(progressValues.length).toBe(1);
		expect(progressValues[0]).toBe(1);
	});

	it("reports progress in increasing steps up to 100%", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const progressValues: number[] = [];
		stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 5,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 250, seed: 42 },
			(p) => progressValues.push(p),
		);

		expect(progressValues.length).toBeGreaterThan(1);
		expect(progressValues[0]).toBeGreaterThan(0);
		expect(progressValues[progressValues.length - 1]).toBe(1);
		for (let i = 1; i < progressValues.length; i++) {
			expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
		}
	});

	it("each partial result has valid band structure", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const partials: StochasticProjectionResult[] = [];
		const final = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 250, seed: 42 },
			(_p, partial) => partials.push(partial),
		);

		for (const partial of partials) {
			expect(partial.bands.length).toBeGreaterThan(0);
			for (const band of partial.bands) {
				expect(band.netWorth.p10).toBeLessThanOrEqual(band.netWorth.p50);
				expect(band.netWorth.p50).toBeLessThanOrEqual(band.netWorth.p90);
			}
			expect(thresholdProbability(partial)).toBeGreaterThanOrEqual(0);
			expect(thresholdProbability(partial)).toBeLessThanOrEqual(1);
		}

		const lastPartial = partials[partials.length - 1];
		expect(lastPartial.bands[0].netWorth.p50).toBe(final.bands[0].netWorth.p50);
		expect(thresholdProbability(lastPartial)).toBe(thresholdProbability(final));
		expect(lastPartial.evaluations).toEqual(final.evaluations);
		expect(fiResult(lastPartial)?.candidateWithdrawalDiagnostics).toEqual(
			fiResult(final)?.candidateWithdrawalDiagnostics,
		);
	});

	it("last partial result matches the final return value", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Document is null");
		expect(document).not.toBeNull();

		const partials: StochasticProjectionResult[] = [];
		const final = stochasticProject(
			document,
			makeSettings({
				fallbackProjectionStartDate: "2026-04-01",
				horizonYears: 10,
			}),
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 250, seed: 42 },
			(_p, partial) => partials.push(partial),
		);

		expect(partials.length).toBeGreaterThanOrEqual(1);
		const last = partials[partials.length - 1];
		expect(last.bands.length).toBe(final.bands.length);
		for (let i = 0; i < final.bands.length; i++) {
			expect(last.bands[i].netWorth.p50).toBe(final.bands[i].netWorth.p50);
			expect(last.bands[i].netWorth.p90 - last.bands[i].netWorth.p10).toBe(
				final.bands[i].netWorth.p90 - final.bands[i].netWorth.p10,
			);
		}
	});
});
