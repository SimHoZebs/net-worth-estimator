import type { FundingGap } from "./fundingGaps.ts";
import { summarizeFundingGap } from "./fundingGaps.ts";
import { shiftDate } from "./format.ts";
import type { Projection, RangeResult } from "./result.ts";

export interface LineChartGeometry {
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	low: number;
	high: number;
	x: (index: number) => number;
	y: (value: number) => number;
	line: (series: number[]) => string;
	grid: number[];
	indexAt: (fraction: number) => number;
}

/**
 * Shared geometry for SVG line charts: uniform scales, path builders, five
 * gridlines, and pointer-fraction lookup. Callers own their bounds
 * (projection padding vs. funding window padding) and dimensions; every plot
 * renders through these scales so strokes and dots stay undistorted.
 */
export function lineChartModel({
	xMax,
	low,
	high,
	width,
	height,
	left,
	right,
	top,
	bottom,
}: {
	/** Maximum x index. Use slots - 1, or slots for a trailing marker slot. */
	xMax: number;
	low: number;
	high: number;
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
}): LineChartGeometry {
	const x = (index: number) =>
		left + (index / Math.max(1, xMax)) * (width - left - right);
	const y = (value: number) =>
		height - bottom - ((value - low) / (high - low)) * (height - top - bottom);
	const line = (series: number[]) =>
		series
			.map(
				(value, index) =>
					`${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
			)
			.join(" ");
	return {
		width,
		height,
		left,
		right,
		top,
		bottom,
		low,
		high,
		x,
		y,
		line,
		grid: [0, 1, 2, 3, 4].map((index) => low + ((high - low) * index) / 4),
		indexAt: (fraction: number) =>
			Math.max(
				0,
				Math.min(
					xMax,
					Math.round(
						((fraction * width - left) / (width - left - right)) * xMax,
					),
				),
			),
	};
}

export function projectionChartModel({
	projection,
	range,
	inflation,
	realTerms,
	narrow,
}: {
	projection: Projection;
	range: RangeResult | null;
	inflation: number;
	realTerms: boolean;
	narrow: boolean;
}) {
	const { points } = projection;
	const start = points[0];
	const last = points.at(-1);
	if (!start || !last) return null;
	const adjust = (value: number, date: string) =>
		realTerms
			? value /
				(1 + inflation / 100) **
					((Date.parse(date) - Date.parse(start.date)) / (365.25 * 86400000))
			: value;
	const values = points.map((point) => adjust(point.total, point.date));
	const upper =
		range?.points.map((point) => adjust(point.upper, point.date)) ?? values;
	const lower =
		range?.points.map((point) => adjust(point.lower, point.date)) ?? values;
	// The domain adapts to the data's sign. Positive wealth keeps the $0
	// floor and 8% headroom; all-debt windows pin both bounds near the data
	// instead of wasting the chart on the unreachable $0 ceiling.
	const peak = Math.max(...upper, ...values);
	const trough = Math.min(...lower, ...values);
	const span = Math.max(1, peak - trough);
	// Minimum zoom: a dormant window would otherwise collapse to a pennies
	// domain with five identical gridlines.
	const pad = Math.max(
		span * 0.08,
		Math.abs(peak) * 0.01,
		Math.abs(trough) * 0.01,
	);
	const high = peak >= 0 ? Math.max(...upper, ...values, 1) * 1.08 : peak + pad;
	const low = trough >= 0 ? Math.min(0, ...lower, ...values) : trough - pad;
	const width = narrow ? 440 : 820;
	const height = narrow ? 260 : 280;
	const left = 63,
		right = 24,
		top = 15,
		bottom = 35;
	const geometry = lineChartModel({
		xMax: points.length - 1,
		low,
		high,
		width,
		height,
		left,
		right,
		top,
		bottom,
	});
	const { x, y, line, grid, indexAt } = geometry;
	const basePath = line(values);
	const filledBasePath = `${basePath} L${x(points.length - 1)},${y(low)} L${left},${y(low)} Z`;
	const medianPath = range
		? line(range.points.map((point) => adjust(point.median, point.date)))
		: null;
	const bands = new Map(range?.points.map((band) => [band.date, band]));
	const rows = points
		.filter(
			(point, index) =>
				index === 0 ||
				index === points.length - 1 ||
				point.date.slice(5, 10) === "12-31",
		)
		.map((point) => {
			const band = bands.get(point.date);
			return {
				date: point.date,
				total: adjust(point.total, point.date),
				band: band
					? {
							lower: adjust(band.lower, point.date),
							median: adjust(band.median, point.date),
							upper: adjust(band.upper, point.date),
						}
					: null,
			};
		});
	return {
		points,
		start,
		last,
		adjust,
		values,
		high,
		low,
		width,
		height,
		left,
		right,
		top,
		bottom,
		x,
		y,
		line,
		grid,
		basePath,
		filledBasePath,
		medianPath,
		hasRange: range !== null,
		rows,
		area: `${line(upper)} ${lower
			.map((value, index) => `L${x(index)},${y(value)}`)
			.reverse()
			.join(" ")} Z`,
		indexAt,
	};
}

export type ChartModel = NonNullable<ReturnType<typeof projectionChartModel>>;

/**
 * Balance-path model for one funding gap, built on lineChartModel. The
 * trailing x slot holds the refused payment: an explanatory red vector past
 * the last executed transaction that is never posted.
 */
export function fundingGapChartModel({
	gap,
	narrow,
}: {
	gap: FundingGap;
	narrow: boolean;
}) {
	const summary = summarizeFundingGap(gap);
	const balances = [
		gap.openingBalance,
		...summary.rows.map((row) => row.balanceAfter),
	];
	const hypothetical = summary.projectedBalanceIfExecuted;
	const peak = Math.max(0, ...balances, hypothetical);
	const floor = Math.min(0, ...balances, hypothetical);
	const span = Math.max(1, peak - floor);
	const high = Math.max(1000, peak) + Math.max(450, span * 0.13);
	const low = floor - Math.max(350, span * 0.09);
	const width = narrow ? 440 : 680;
	const height = narrow ? 260 : 280;
	const left = 63,
		right = 24,
		top = 15,
		bottom = 35;
	const count = balances.length;
	const { x, y, line, grid } = lineChartModel({
		xMax: count,
		low,
		high,
		width,
		height,
		left,
		right,
		top,
		bottom,
	});
	const balancePath = line(balances);
	const endX = x(count - 1);
	const failX = x(count);
	const endY = y(balances[count - 1] ?? 0);
	const failY = y(hypothetical);
	return {
		summary,
		balances,
		hypothetical,
		low,
		high,
		width,
		height,
		left,
		right,
		top,
		bottom,
		x,
		y,
		balancePath,
		areaPath: `${balancePath} L${endX.toFixed(1)},${y(low).toFixed(1)} L${x(0).toFixed(1)},${y(low).toFixed(1)} Z`,
		refusalPath: `M${endX.toFixed(1)},${endY.toFixed(1)} L${failX.toFixed(1)},${failY.toFixed(1)}`,
		endX,
		failX,
		endY,
		failY,
		baseline: y(0),
		grid,
	};
}

export type FundingGapChartModel = ReturnType<typeof fundingGapChartModel>;

/**
 * Trailing window for the net-worth graph: the last 30 calendar days ending
 * today, inclusive on both ends.
 */
export const TRAILING_NET_WORTH_DAYS = 30;

/**
 * Expand sparse projection points into one point per day across the trailing
 * window ending `today`. Each day carries the latest known total at or before
 * that day; days before the first known point carry the earliest total. The
 * engine only emits rows on event dates, so forward-filling is what turns
 * those rows into a continuous daily line.
 */
export function trailingDailyPoints(
	points: ReadonlyArray<Projection["points"][number]>,
	today: string,
	days: number = TRAILING_NET_WORTH_DAYS,
): Projection["points"] {
	if (points.length === 0 || days < 1) return [];
	const end = today.slice(0, 10);
	const sorted = [...points].sort((left, right) =>
		left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
	);
	const start = shiftDate({ date: end, days: -(days - 1) });
	const result: Projection["points"] = [];
	for (let offset = 0; offset < days; offset++) {
		const date = shiftDate({ date: start, days: offset });
		let current = sorted[0]!;
		for (const point of sorted) {
			if (point.date.slice(0, 10) <= date) current = point;
			else break;
		}
		result.push({ date, total: current.total, balances: {} });
	}
	return result;
}

/**
 * Index of the plotted point at or nearest `today` (a YYYY-MM-DD date).
 * The result is always a valid index: today before the first point yields 0
 * and today after the last point yields the last index. Ties prefer the
 * earlier point so the default never jumps into the future on a coin flip.
 */
export function nearestPointIndex(
	points: ReadonlyArray<{ date: string }>,
	today: string,
): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	const target = Date.parse(today);
	for (const [index, point] of points.entries()) {
		const time = Date.parse(point.date.slice(0, 10));
		const distance =
			Number.isNaN(time) || Number.isNaN(target)
				? Number.POSITIVE_INFINITY
				: Math.abs(time - target);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	}
	return best;
}
export function projectionCsv(rows: ChartModel["rows"]) {
	return [
		"Date,Base case,10th percentile,Median,90th percentile",
		...rows.map((point) =>
			[
				point.date,
				point.total.toFixed(2),
				...[point.band?.lower, point.band?.median, point.band?.upper].map(
					(value) => (value === undefined ? "" : value.toFixed(2)),
				),
			].join(","),
		),
	].join("\n");
}
