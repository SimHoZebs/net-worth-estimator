import type { Projection, RangeResult } from "./projection.ts";

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
	const high = Math.max(...upper, ...values, 1) * 1.08;
	const low = Math.min(0, ...lower, ...values);
	const width = narrow ? 440 : 820;
	const height = narrow ? 260 : 280;
	const left = 63,
		right = 24,
		top = 15,
		bottom = 35;
	const x = (index: number) =>
		left + (index / Math.max(1, points.length - 1)) * (width - left - right);
	const y = (value: number) =>
		height - bottom - ((value - low) / (high - low)) * (height - top - bottom);
	const line = (series: number[]) =>
		series
			.map(
				(value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`,
			)
			.join(" ");
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
		basePath,
		filledBasePath,
		medianPath,
		hasRange: range !== null,
		rows,
		area: `${line(upper)} ${lower
			.map((value, index) => `L${x(index)},${y(value)}`)
			.reverse()
			.join(" ")} Z`,
		indexAt: (fraction: number) =>
			Math.max(
				0,
				Math.min(
					points.length - 1,
					Math.round(
						((fraction * width - left) / (width - left - right)) *
							(points.length - 1),
					),
				),
			),
	};
}

export type ChartModel = NonNullable<ReturnType<typeof projectionChartModel>>;
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
