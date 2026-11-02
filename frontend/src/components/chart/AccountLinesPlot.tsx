import { colorLegend, defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import { accountTrendRows, netWorthDomain } from "../../domain/chart.ts";
import {
	compactMoney,
	dateLabel,
	money,
	monthDay,
} from "../../domain/format.ts";
import type { Projection } from "../../domain/result.ts";
import { seriesTexture, toneToken } from "../texture/texture.ts";

/** Dash counterpart to each texture pattern: color is never the sole carrier. */
const DASH_BY_PATTERN: Record<string, string | undefined> = {
	solid: undefined,
	stripes: "6 3",
	dots: "1.5 3",
	hatch: "8 3 2 3",
};

/**
 * Per-account balances as lines on one shared scale: every account shares
 * the zero baseline, so slopes and crossings compare directly and debts plot
 * below zero. Color repeats the series identity with a dash pattern so no
 * series relies on color alone. The rows come from the same forward-filled
 * window as the total line, so both views agree on every day.
 */
export function AccountLinesPlot({
	points,
	accounts,
	height,
}: {
	points: Projection["points"];
	accounts: ReadonlyArray<{ id: string; name: string }>;
	height?: number;
}) {
	const { rows, series } = useMemo(
		() => accountTrendRows({ points, accounts }),
		[points, accounts],
	);
	const paints = useMemo(
		() =>
			series.map((entry) => {
				const { tone, pattern } = seriesTexture(entry.colorIndex);
				return {
					entry,
					color: toneToken(tone),
					dash: DASH_BY_PATTERN[pattern],
				};
			}),
		[series],
	);
	const { low, high, showZero } = useMemo(() => {
		const { low, high } = netWorthDomain(rows.map((row) => row.balance));
		// Same sign-adaptive floor as the total line: the $0 rule renders
		// exactly when the scale includes it.
		return { low, high, showZero: high >= 0 };
	}, [rows]);
	const definition = useMemo(() => {
		const names = series.map((entry) => entry.name);
		const paintById = new Map(paints.map((paint) => [paint.entry.id, paint]));
		// One line mark per series: strokeDasharray is whole-mark, so
		// per-series dashes need per-series marks. The shared color channel
		// keeps grouping, the legend, and grouped focus working.
		const lines = series.map((entry) => {
			const paint = paintById.get(entry.id)!;
			return lineY(
				rows.filter((row) => row.account === entry.name),
				{
					x: "date",
					y: "balance",
					color: "account",
					stroke: paint.color,
					strokeWidth: 2.25,
					...(paint.dash ? { strokeDasharray: paint.dash } : {}),
				},
			);
		});
		return defineChart({
			marks: [
				...lines,
				...(showZero ? [ruleY([0])] : []),
				crosshair({
					x: {
						label: {
							format: (value) =>
								typeof value === "string" ? monthDay(value) : String(value),
						},
					},
					y: {
						label: {
							format: (value) =>
								typeof value === "number" ? compactMoney(value) : "",
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
						label: "Balance (USD)",
						ticks: { format: (value: number) => compactMoney(value) },
					},
				},
			},
			color: {
				domain: names,
				range: paints.map(({ color }) => color),
				legend: colorLegend({ label: "Account" }),
			},
			focus: "group-x",
			maxFocusDistance: Number.POSITIVE_INFINITY,
			tooltip: {
				use: tooltip,
				formatGroup: (grouped) => {
					const first = grouped[0];
					const heading = first
						? dateLabel(String(first.xValue).slice(0, 10), true)
						: "";
					const lines = grouped.map((point) => {
						const datum = point.datum as { balance?: unknown };
						const balance =
							typeof datum.balance === "number"
								? datum.balance
								: Number(point.yValue);
						return `${point.groupLabel}: ${money(balance)}`;
					});
					return [heading, ...lines].join("\n");
				},
			},
		});
	}, [rows, series, paints, low, high, showZero]);
	if (!series.length || !rows.length) {
		return (
			<p className="m-0 text-sm text-muted">
				No per-account data in this window.
			</p>
		);
	}
	const debt = rows.some((row) => row.balance < 0);
	const total = series.reduce((sum, entry) => sum + entry.endBalance, 0);
	const description =
		`Daily balances for ${series.length} visible accounts ending ` +
		`${money(total)} in total.` +
		(debt ? " Debts plot below zero." : "");
	return (
		<Chart
			definition={definition}
			ariaLabel="Net worth by account over the trailing window"
			ariaDescription={description}
			height={height ?? 280}
		/>
	);
}
