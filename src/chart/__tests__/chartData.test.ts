import { describe, expect, it } from "vitest";
import type {
	ScenarioWhatIfState,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	parseCsvScenarioPack,
	projectScenarioPack,
	stochasticProject,
} from "@/lib/projection";
import { makeSettings, validCsvFiles } from "@/lib/projection/__fixtures__";
import { buildAccountDiagnosticChartData } from "../chartData";

const PROJECTION_SETTINGS = makeSettings({
	fallbackProjectionStartDate: "2026-04-01",
	horizonYears: 5,
});

const EMPTY_WHAT_IF: ScenarioWhatIfState = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

describe("buildAccountDiagnosticChartData", () => {
	it("returns per-account balances and deterministic net worth when no stochastic data is provided", () => {
		const { data: pack } = parseCsvScenarioPack(validCsvFiles);
		expect(pack).not.toBeNull();

		if (!pack) throw new Error("Pack failed to load");
		const result = projectScenarioPack(
			pack,
			PROJECTION_SETTINGS,
			EMPTY_WHAT_IF,
		);
		const data = buildAccountDiagnosticChartData(pack, result);

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

		for (const account of pack.accounts.filter((a) => a.enabled)) {
			expect(typeof data[0][account.id]).toBe("number");
		}
	});

	it("merges stochastic band data into rows when stochastic result is provided", () => {
		const { data: pack } = parseCsvScenarioPack(validCsvFiles);
		expect(pack).not.toBeNull();

		if (!pack) throw new Error("Pack failed to load");
		const stochasticResult = stochasticProject(
			pack,
			PROJECTION_SETTINGS,
			EMPTY_WHAT_IF,
			{
				runCount: 50,
				seed: 42,
			},
		);

		const data = buildAccountDiagnosticChartData(
			pack,
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
		const { data: pack } = parseCsvScenarioPack(validCsvFiles);
		expect(pack).not.toBeNull();

		if (!pack) throw new Error("Pack failed to load");
		const result = projectScenarioPack(
			pack,
			PROJECTION_SETTINGS,
			EMPTY_WHAT_IF,
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
			evaluationOrder: [],
			evaluations: {},
		};

		const data = buildAccountDiagnosticChartData(pack, result, fakeStochastic);

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
