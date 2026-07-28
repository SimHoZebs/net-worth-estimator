import { describe, expect, it } from "vitest";
import type {
	ModelOverrides,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	parseCsvFinancialModel,
	projectFinancialModelDocument,
	stochasticProject,
} from "@/lib/projection";
import { makeSettings, validCsvFiles } from "@/lib/projection/__fixtures__";
import { buildAccountDiagnosticChartData } from "../chartData";

const PROJECTION_SETTINGS = makeSettings({
	fallbackProjectionStartDate: "2026-04-01",
	horizonYears: 5,
});

const EMPTY_MODEL_OVERRIDES: ModelOverrides = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

describe("buildAccountDiagnosticChartData", () => {
	it("returns per-account balances and deterministic net worth when no stochastic data is provided", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		expect(document).not.toBeNull();

		if (!document) throw new Error("Financial model failed to load");
		const result = projectFinancialModelDocument(
			document,
			PROJECTION_SETTINGS,
			EMPTY_MODEL_OVERRIDES,
		);
		const data = buildAccountDiagnosticChartData(document, result);

		expect(data.length).toBeGreaterThan(0);
		expect(data[0].date).toBeDefined();
		expect(typeof data[0].netWorth).toBe("number");

		for (const row of data) {
			expect(typeof row.netWorth).toBe("number");
			expect(row._hasStochastic).toBe(0);
			expect(row.outerThickness).toBe(0);
			expect(row.innerThickness).toBe(0);
			expect(row.p10_base).toBe(row.netWorth);
			expect(row.p25_base).toBe(row.netWorth);
			expect(row.p50).toBe(row.netWorth);
		}

		for (const account of document.accounts.filter((a) => a.enabled)) {
			expect(typeof data[0][account.id]).toBe("number");
		}
	});

	it("merges stochastic band data into rows when stochastic result is provided", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		expect(document).not.toBeNull();

		if (!document) throw new Error("Financial model failed to load");
		const stochasticResult = stochasticProject(
			document,
			PROJECTION_SETTINGS,
			EMPTY_MODEL_OVERRIDES,
			{
				runCount: 50,
				seed: 42,
			},
		);

		const data = buildAccountDiagnosticChartData(
			document,
			stochasticResult.deterministic,
			stochasticResult,
		);

		expect(data.length).toBeGreaterThan(0);

		const hasBands = data.some((row) => row._hasStochastic === 1);
		expect(hasBands).toBe(true);

		const bandByDate = new Map(stochasticResult.bands.map((b) => [b.date, b]));

		for (const row of data) {
			expect(typeof row.netWorth).toBe("number");
			expect(typeof row.p10_base).toBe("number");
			expect(typeof row.outerThickness).toBe("number");
			expect(typeof row.p25_base).toBe("number");
			expect(typeof row.innerThickness).toBe("number");
			expect(typeof row.p50).toBe("number");

			const band = bandByDate.get(row.date as string);
			if (band) {
				expect(row._hasStochastic).toBe(1);
				expect(row.p10_base).toBe(band.netWorth.p10);
				expect(row.outerThickness).toBe(band.netWorth.p90 - band.netWorth.p10);
				expect(row.p25_base).toBe(band.netWorth.p25);
				expect(row.innerThickness).toBe(band.netWorth.p75 - band.netWorth.p25);
				expect(row.p50).toBe(band.netWorth.p50);
				expect(row._p10).toBe(band.netWorth.p10);
				expect(row._p90).toBe(band.netWorth.p90);
				expect(row._p25).toBe(band.netWorth.p25);
				expect(row._p75).toBe(band.netWorth.p75);
			} else {
				expect(row._hasStochastic).toBe(0);
				expect(row.outerThickness).toBe(0);
				expect(row.p10_base).toBe(row.netWorth);
				expect(row.p50).toBe(row.netWorth);
			}
		}
	});

	it("falls back to deterministic net worth for sampled row dates missing from band map", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		expect(document).not.toBeNull();

		if (!document) throw new Error("Financial model failed to load");
		const result = projectFinancialModelDocument(
			document,
			PROJECTION_SETTINGS,
			EMPTY_MODEL_OVERRIDES,
		);

		const fakeStochastic: StochasticProjectionResult = {
			config: { runCount: 10, seed: null },
			deterministic: result,
			bands: [
				{
					date: "9999-01-01",
					isHistorical: false,
					netWorth: {
						p10: 400_000,
						p25: 450_000,
						p50: 500_000,
						p75: 550_000,
						p90: 600_000,
					},
				},
			],
			milestones: {
				finalNetWorthPercentiles: {
					p10: 300_000,
					p25: 400_000,
					p50: 500_000,
					p75: 600_000,
					p90: 700_000,
				},
			},
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
		};

		const data = buildAccountDiagnosticChartData(
			document,
			result,
			fakeStochastic,
		);

		expect(data.length).toBeGreaterThan(0);

		for (const row of data) {
			if (row.date === "9999-01-01") {
				expect(row._hasStochastic).toBe(1);
				expect(row.p10_base).toBe(400_000);
				expect(row.p50).toBe(500_000);
				expect(row.outerThickness).toBe(200_000);
			} else {
				expect(row._hasStochastic).toBe(0);
				expect(row.outerThickness).toBe(0);
				expect(row.p10_base).toBe(row.netWorth);
				expect(row.p25_base).toBe(row.netWorth);
				expect(row.p50).toBe(row.netWorth);
			}
		}
	});
});
