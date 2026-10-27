import { describe, expect, it } from "vitest";
import { projectionFixture } from "../mocks/projection.ts";
import { compactMoney } from "./format.ts";
import type { FundingGap } from "./fundingGaps.ts";
import {
	fundingGapChartModel,
	lineChartModel,
	nearestPointIndex,
	projectionChartModel,
	projectionCsv,
	trailingDailyPoints,
	TRAILING_NET_WORTH_DAYS,
} from "./chart.ts";

const projection = projectionFixture();
const options = {
	projection,
	range: null,
	inflation: 5,
	realTerms: false,
	narrow: false,
};

describe("chart presentation data", () => {
	it("uses identical values for annual rows and CSV", () => {
		const model = projectionChartModel(options);
		if (!model) throw new Error("Expected chart");
		const csv = projectionCsv(model.rows).split("\n");
		expect(csv).toHaveLength(model.rows.length + 1);
		for (const [index, row] of model.rows.entries()) {
			const cells = csv[index + 1]?.split(",") ?? [];
			expect(cells[0]).toBe(row.date);
			expect(Number(cells[1])).toBeCloseTo(row.total, 2);
		}
	});
	it("adjusts bands and base case by the same inflation factor", () => {
		const range = {
			points: projection.points.map((point) => ({
				date: point.date,
				lower: point.total * 0.9,
				median: point.total,
				upper: point.total * 1.1,
			})),
			count: 10,
			evaluationSuccess: {},
			failureShare: 0,
		};
		const model = projectionChartModel({ ...options, range, realTerms: true });
		if (!model) throw new Error("Expected chart");
		for (const row of model.rows) {
			expect(row.band?.median).toBe(row.total);
			expect(row.band?.lower).toBeCloseTo(row.total * 0.9);
		}
		expect(model.rows.at(-1)?.total).toBeLessThan(
			projection.points.at(-1)?.total ?? 0,
		);
	});
	it("keeps pointer selection in bounds and handles one-point geometry", () => {
		const single = { ...projection, points: projection.points.slice(0, 1) };
		const model = projectionChartModel({ ...options, projection: single });
		if (!model) throw new Error("Expected chart");
		expect(model.indexAt(-1)).toBe(0);
		expect(model.indexAt(2)).toBe(0);
		expect(model.basePath).not.toMatch(/NaN|Infinity/);
		expect(
			projectionChartModel({
				...options,
				projection: { ...projection, points: [] },
			}),
		).toBeNull();
	});
	it.each([false, true])(
		"prepares every plotted path in realTerms=%s",
		(realTerms) => {
			const range = {
				points: projection.points.map((point) => ({
					date: point.date,
					lower: point.total * 0.9,
					median: point.total,
					upper: point.total * 1.1,
				})),
				count: 10,
				evaluationSuccess: {},
				failureShare: 0,
			};
			const model = projectionChartModel({ ...options, range, realTerms });
			if (!model) throw new Error("Expected chart");
			expect(model.medianPath).toBe(model.basePath);
			expect(model.filledBasePath.startsWith(model.basePath)).toBe(true);
			for (const path of [
				model.basePath,
				model.filledBasePath,
				model.medianPath,
				model.area,
			]) {
				expect(path).toMatch(/^M/);
				expect(path).not.toMatch(/NaN|Infinity/);
			}
		},
	);
	describe("shared line geometry", () => {
		const gap: FundingGap = {
			id: "rent",
			date: "2030-09-25",
			name: "Rent",
			fundingAccount: { id: "checking", name: "Checking" },
			openingBalance: 1000,
			requiredAmount: 9000,
			availableAmount: 2500,
			unfulfilledAmount: 6500,
			windowStartDate: "2030-09-01",
			movements: [
				{
					id: "pay",
					date: "2030-09-10",
					name: "Payroll",
					amount: 2000,
					kind: "income",
				},
				{
					id: "bill",
					date: "2030-09-20",
					name: "Bill",
					amount: -500,
					kind: "utilities",
				},
			],
		};
		it("builds the funding path on the same scales as the projection", () => {
			const model = fundingGapChartModel({ gap, narrow: false });
			expect(model.width).toBe(680);
			expect(model.grid).toHaveLength(5);
			for (const path of [
				model.balancePath,
				model.areaPath,
				model.refusalPath,
			]) {
				expect(path).toMatch(/^M/);
				expect(path).not.toMatch(/NaN|Infinity/);
			}
			// Refusal vector lands past the last executed movement, below it.
			expect(model.failX).toBeGreaterThan(model.endX);
			expect(model.failY).toBeGreaterThan(model.endY);
			expect(model.summary.shortfall).toBe(9000 - 2500);
		});
		it("keeps lookup and geometry in bounds for a single movement", () => {
			const geometry = lineChartModel({
				xMax: 1,
				low: -100,
				high: 100,
				width: 440,
				height: 260,
				left: 63,
				right: 24,
				top: 15,
				bottom: 35,
			});
			expect(geometry.indexAt(-1)).toBe(0);
			expect(geometry.indexAt(2)).toBe(1);
			expect(geometry.line([10])).toMatch(/^M/);
			expect(geometry.line([10])).not.toMatch(/NaN|Infinity/);
		});
	});
	describe("trailingDailyPoints", () => {
		// Fixture rows: 2026-01-01 $1,000, 2026-07-01 $1,400, 2027-01-01
		// $1,800. The 30-day window ending 2026-07-01 runs 2026-06-02 to
		// 2026-07-01.
		const today = "2026-07-01";
		it("expands sparse rows into one daily point per day", () => {
			const daily = trailingDailyPoints(projection.points, today);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			expect(daily[0]?.date).toBe("2026-06-02");
			expect(daily.at(-1)?.date).toBe("2026-07-01");
			expect(daily.at(-1)?.total).toBe(1400);
			for (const point of daily.slice(0, -1)) {
				expect(point.total).toBe(1000);
			}
		});
		it("sorts its input and ignores future rows", () => {
			const shuffled = [...projection.points].reverse();
			const daily = trailingDailyPoints(shuffled, today);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			expect(daily.at(-1)?.total).toBe(1400);
		});
		it("backfills days before the first row with the earliest total", () => {
			const daily = trailingDailyPoints(
				[{ date: "2027-01-01", total: 1800, balances: {} }],
				today,
			);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			for (const point of daily) {
				expect(point.total).toBe(1800);
			}
		});
		it("returns no points for empty input", () => {
			expect(trailingDailyPoints([], today)).toEqual([]);
		});
	});
	describe("adaptive domain", () => {
		it("keeps the $0 floor and 8% headroom for positive wealth", () => {
			const model = projectionChartModel(options);
			if (!model) throw new Error("Expected chart");
			expect(model.low).toBe(0);
			expect(model.high).toBeCloseTo(1800 * 1.08, 6);
		});
		it("pins an all-debt window near the data instead of the $0 ceiling", () => {
			const debt = {
				...projection,
				points: [
					{ date: "2026-06-02", total: -66200, balances: {} },
					{ date: "2026-07-01", total: -65800, balances: {} },
				],
			};
			const model = projectionChartModel({ ...options, projection: debt });
			if (!model) throw new Error("Expected chart");
			// Span 400, but the 1% minimum zoom sets padding 662.
			expect(model.high).toBeLessThan(0);
			expect(model.high).toBeCloseTo(-65138, 6);
			expect(model.low).toBeCloseTo(-66862, 6);
		});
		it("keeps a flat all-debt window legible", () => {
			const flat = {
				...projection,
				points: [
					{ date: "2026-06-02", total: -66000, balances: {} },
					{ date: "2026-07-01", total: -66000, balances: {} },
				],
			};
			const model = projectionChartModel({ ...options, projection: flat });
			if (!model) throw new Error("Expected chart");
			expect(model.high).toBeCloseTo(-65340, 6);
			expect(model.low).toBeCloseTo(-66660, 6);
			expect(model.high - model.low).toBeGreaterThanOrEqual(1000);
			const labels = new Set(model.grid.map((value) => compactMoney(value)));
			expect(labels.size).toBeGreaterThan(1);
		});
		it("pads below a window that straddles $0", () => {
			const crossing = {
				...projection,
				points: [
					{ date: "2026-06-02", total: -100, balances: {} },
					{ date: "2026-07-01", total: 200, balances: {} },
				],
			};
			const model = projectionChartModel({
				...options,
				projection: crossing,
			});
			if (!model) throw new Error("Expected chart");
			expect(model.high).toBeCloseTo(200 * 1.08, 6);
			expect(model.low).toBeCloseTo(-124, 6);
		});
	});
	describe("nearestPointIndex", () => {
		const points = [
			{ date: "2026-01-01" },
			{ date: "2026-07-01" },
			{ date: "2027-01-01" },
		];
		it("returns the exact match when today is a plotted date", () => {
			expect(nearestPointIndex(points, "2026-07-01")).toBe(1);
		});
		it("returns the nearest point when today falls between dates", () => {
			expect(nearestPointIndex(points, "2026-08-15")).toBe(1);
			expect(nearestPointIndex(points, "2026-11-15")).toBe(2);
		});
		it("prefers the earlier point on a tie", () => {
			const even = [{ date: "2026-01-01" }, { date: "2026-01-03" }];
			expect(nearestPointIndex(even, "2026-01-02")).toBe(0);
		});
		it("clamps today outside the projection to the nearest end", () => {
			expect(nearestPointIndex(points, "2020-05-05")).toBe(0);
			expect(nearestPointIndex(points, "2035-05-05")).toBe(2);
		});
		it("handles a single point and an empty list", () => {
			expect(nearestPointIndex([{ date: "2026-01-01" }], "2030-01-01")).toBe(0);
			expect(nearestPointIndex([], "2026-01-01")).toBe(0);
		});
	});
});
