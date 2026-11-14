import { areaY, defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import { netWorthDomain } from "../../domain/chart.ts";
import {
	compactMoney,
	dateLabel,
	money,
	monthDay,
} from "../../domain/format.ts";

/**
 * Trailing net-worth total as a TanStack line plus area. The area fills to
 * the domain floor and the line carries the exact totals; a zero rule marks
 * no debt whenever the window touches or crosses $0. Dates stay as ISO days
 * so the point domain is stable across years; the axis formats them short.
 */
export function NetWorthTrendPlot({
	points,
	days,
	height,
}: {
	points: ReadonlyArray<{ date: string; total: number }>;
	days: number;
	height?: number;
}) {
	const rows = useMemo(
		() =>
			points.map((point) => ({
				date: point.date.slice(0, 10),
				total: point.total,
			})),
		[points],
	);
	const { low, high, showZero } = useMemo(() => {
		const totals = rows.map((row) => row.total);
		const { low, high } = netWorthDomain(totals);
		// The domain keeps the $0 floor exactly when data touches or
		// crosses it, so the zero rule follows the scale, not a recheck.
		return { low, high, showZero: high >= 0 };
	}, [rows]);
	const start = rows[0];
	const last = rows.at(-1);
	const definition = useMemo(
		() =>
			defineChart({
				marks: [
					areaY(rows, {
						x: "date",
						// Explicit interval, not the implicit zero baseline: the
						// fill runs from the domain floor to the line in both
						// signs. An all-debt window would otherwise fill upward
						// from the line toward an out-of-domain zero.
						y1: low,
						y2: "total",
						fill: "var(--chart-band)",
						fillOpacity: 0.35,
					}),
					lineY(rows, {
						x: "date",
						y: "total",
						stroke: "var(--primary)",
						strokeWidth: 2.5,
					}),
					...(showZero ? [ruleY([0])] : []),
					crosshair({
						x: {
							label: {
								format: (value) =>
									typeof value === "string"
										? dateLabel(value.slice(0, 10), true)
										: "",
							},
						},
						y: {
							label: {
								format: (value) =>
									typeof value === "number" ? money(value) : "",
							},
						},
					}),
				],
				scales: {
					x: {
						scale: () => scalePoint<string>().padding(0.1),
						axis: {
							ticks: {
								spacing: 90,
								format: (value: string) => monthDay(value),
							},
							tickLabels: { thin: { minGap: 16 } },
						},
					},
					y: {
						scale: scaleLinear().domain([low, high]),
						grid: true,
						axis: {
							ticks: { format: (value: number) => compactMoney(value) },
						},
					},
				},
				focus: "nearest-x",
				maxFocusDistance: Number.POSITIVE_INFINITY,
				tooltip: {
					use: tooltip,
					format: (point) => {
						const datum = point.datum as { date?: unknown; total?: unknown };
						const date =
							typeof datum.date === "string"
								? datum.date.slice(0, 10)
								: String(point.xValue).slice(0, 10);
						const total =
							typeof datum.total === "number"
								? datum.total
								: Number(point.yValue);
						return `${dateLabel(date, true)}: ${money(total)}`;
					},
				},
			}),
		[rows, low, high, showZero],
	);
	if (!rows.length || !start || !last) {
		return (
			<p className="m-0 px-5 pb-5 text-sm text-muted-foreground">
				No net-worth data in this window.
			</p>
		);
	}
	const description =
		`Trailing ${rows.length}-day net worth ends at ${money(last.total)} on ` +
		`${dateLabel(last.date, true)}, starting at ${money(start.total)} on ` +
		`${dateLabel(start.date, true)}.` +
		(showZero ? " The solid $0 line marks no debt." : "");
	return (
		<Chart
			definition={definition}
			ariaLabel={`Net worth over the trailing ${days} days`}
			ariaDescription={description}
			height={height ?? 280}
		/>
	);
}
