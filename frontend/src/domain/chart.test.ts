import { describe, expect, it } from "vitest";
import { projectionFixture } from "../test/projection.ts";
import { projectionChartModel, projectionCsv } from "./chart.ts";

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
		for (const [index, row] of model.rows.entries())
			expect(csv[index + 1]).toBe(`${row.date},${row.total.toFixed(2)},,,`);
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
			goalSuccess: {},
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
				goalSuccess: {},
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
});
