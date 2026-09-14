import { describe, expect, it } from "vitest";
import type {
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { parseCsvFinancialModel } from "@/lib/projection";
import { validCsvFiles } from "@/lib/projection/__fixtures__";
import {
	buildAccountDiagnosticChartData,
	buildStochasticChartData,
} from "../chartData";

function sampledRow(
	date: string,
	netWorth: number,
	balances: Record<string, number>,
) {
	return {
		date,
		isHistorical: false,
		netWorth,
		accountSnapshots: Object.entries(balances).map(([accountId, balance]) => ({
			accountId,
			date,
			balance,
			impacts: [],
		})),
		externalInflowAmount: 0,
		externalOutflowAmount: 0,
		internalTransferAmount: 0,
	};
}

function staticResult(balancesByDate: Array<Record<string, number>>) {
	const dates = ["2026-04-01", "2026-05-01", "2026-06-01"];
	const sampledRows = dates.map((date, index) => {
		const balances = balancesByDate[index] ?? {};
		const netWorth = Object.values(balances).reduce(
			(sum, value) => sum + value,
			0,
		);
		return sampledRow(date, netWorth, balances);
	});
	return {
		timeline: { rows: sampledRows, sampledRows },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: null,
			projectionStartDate: "2026-04-01",
		},
		summary: {
			currentNetWorth: sampledRows[0]?.netWorth ?? 0,
			finalNetWorth: sampledRows[sampledRows.length - 1]?.netWorth ?? 0,
		},
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
	} satisfies ProjectionResult;
}

function staticStochastic(
	deterministic: ProjectionResult,
): StochasticProjectionResult {
	return {
		config: { runCount: 50, seed: 42 },
		deterministic,
		bands: deterministic.timeline.sampledRows.map((row) => ({
			date: row.date,
			isHistorical: false,
			netWorth: {
				p10: row.netWorth - 200,
				p25: row.netWorth - 100,
				p50: row.netWorth,
				p75: row.netWorth + 100,
				p90: row.netWorth + 200,
			},
		})),
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
}

describe("buildAccountDiagnosticChartData", () => {
	it("returns per-account balances and deterministic net worth", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		expect(document).not.toBeNull();

		if (!document) throw new Error("Financial model failed to load");
		const enabled = document.accounts.filter((a) => a.enabled);
		const balances = Object.fromEntries(
			enabled.map((account, index) => [account.id, (index + 1) * 1000]),
		);
		const result = staticResult([balances, balances, balances]);
		const data = buildAccountDiagnosticChartData(document, result);

		expect(data.length).toBeGreaterThan(0);
		expect(data[0].date).toBeDefined();
		expect(typeof data[0].netWorth).toBe("number");

		for (const row of data) {
			expect(typeof row.netWorth).toBe("number");
		}

		for (const account of enabled) {
			expect(typeof data[0][account.id]).toBe("number");
		}
	});

	it("merges stochastic band data into rows when stochastic result is provided", () => {
		const result = staticResult([
			{ checking: 1000 },
			{ checking: 1100 },
			{ checking: 1200 },
		]);
		const stochasticResult = staticStochastic(result);

		const data = buildStochasticChartData(
			stochasticResult.deterministic,
			stochasticResult,
		);

		expect(data.length).toBeGreaterThan(0);

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
				expect(row.outerThickness).toBe(0);
				expect(row.p10_base).toBe(row.netWorth);
				expect(row.p50).toBe(row.netWorth);
			}
		}
	});

	it("falls back to deterministic net worth for sampled row dates missing from band map", () => {
		const result = staticResult([
			{ checking: 1000 },
			{ checking: 1100 },
			{ checking: 1200 },
		]);

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

		const data = buildStochasticChartData(result, fakeStochastic);

		expect(data.length).toBeGreaterThan(0);

		for (const row of data) {
			if (row.date === "9999-01-01") {
				expect(row.p10_base).toBe(400_000);
				expect(row.p50).toBe(500_000);
				expect(row.outerThickness).toBe(200_000);
			} else {
				expect(row.outerThickness).toBe(0);
				expect(row.p10_base).toBe(row.netWorth);
				expect(row.p25_base).toBe(row.netWorth);
				expect(row.p50).toBe(row.netWorth);
			}
		}
	});

	it("preserves first-match account lookup behavior", () => {
		const { data: document } = parseCsvFinancialModel(validCsvFiles);
		if (!document) throw new Error("Financial model failed to load");
		const result = staticResult([
			{ checking: 1000 },
			{ checking: 1100 },
			{ checking: 1200 },
		]);
		const firstRow = result.timeline.sampledRows[0];
		const firstSnapshot = firstRow?.accountSnapshots[0];
		if (!firstRow || !firstSnapshot) throw new Error("Projection row is empty");
		firstRow.accountSnapshots.push({ ...firstSnapshot, balance: 999_999 });

		const data = buildAccountDiagnosticChartData(document, result);

		expect(data[0]?.[firstSnapshot.accountId]).toBe(firstSnapshot.balance);
	});
});
