import { type ChartPoint, defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import {
	type AccountTrendPoint,
	accountTrendRows,
	assignAccountDashes,
	netWorthDomain,
} from "../../domain/chart.ts";
import {
	compactMoney,
	dateLabel,
	money,
	monthDay,
} from "../../domain/format.ts";
import type { Projection } from "../../domain/result.ts";
import { seriesTexture, toneToken } from "../texture/texture.ts";

/** One legend line sample with the series dash pattern as a CSS gradient. */
function dashImage(dash: string | undefined, color: string) {
	if (!dash) return undefined;
	let offset = 0;
	const stops = dash
		.trim()
		.split(/\s+/)
		.map((length, index) => {
			const start = offset;
			offset += Number(length);
			return `${index % 2 === 0 ? color : "transparent"} ${start}px ${offset}px`;
		});
	return `repeating-linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * Per-account balances as colored lines on one shared scale: every account
 * shares the zero baseline, so slopes and crossings compare directly and
 * debts plot below zero. Series pair their tone with a dash pattern, and
 * the key below shows the actual line for each, so identity never rides
 * on color alone. The rows come from the same forward-filled window as
 * the total line, so both views agree on every day.
 */
export function AccountLinesPlot({
	points,
	accounts,
	height,
}: {
	points: Projection["points"];
	accounts: ReadonlyArray<{
		id: string;
		name: string;
		display?: import("../../domain/model.ts").Account["display"];
	}>;
	height?: number;
}) {
	const { rows, series } = useMemo(
		() => accountTrendRows({ points, accounts }),
		[points, accounts],
	);
	const styles = useMemo(() => {
		const dashes = assignAccountDashes(series);
		return series.map((entry, index) => {
			const { tone } = seriesTexture(entry.colorIndex);
			return { entry, color: toneToken(tone), dash: dashes[index] };
		});
	}, [series]);
	const { low, high, showZero } = useMemo(() => {
		const { low, high } = netWorthDomain(rows.map((row) => row.balance));
		// Same sign-adaptive floor as the total line: the $0 rule renders
		// exactly when the scale includes it.
		return { low, high, showZero: high >= 0 };
	}, [rows]);
	const definition = useMemo(() => {
		const names = series.map((entry) => entry.name);
		const dashById = new Map(styles.map((style) => [style.entry.id, style]));
		// One line mark per series: strokeDasharray is whole-mark, so
		// per-series dashes need per-series marks. The shared color channel
		// keeps grouping and grouped focus working.
		const lines = series.map((entry) => {
			const style = dashById.get(entry.id)!;
			return lineY(
				rows.filter((row) => row.account === entry.name),
				{
					x: "date",
					y: "balance",
					color: "account",
					stroke: style.color,
					strokeWidth: 2.25,
					lineCap: "round",
					...(style.dash ? { strokeDasharray: style.dash } : {}),
				},
			);
		});
		return defineChart(({ width }) => ({
			// The rotated axis title costs ~25px of plot width; drop it in
			// narrow containers and let the compact tick labels carry units.
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
						...(width < 640 ? {} : { label: "Balance (USD)" }),
						ticks: { format: (value: number) => compactMoney(value) },
					},
				},
			},
			color: {
				domain: names,
				range: styles.map(({ color }) => color),
			},
			focus: "group-x",
			maxFocusDistance: Number.POSITIVE_INFINITY,
			tooltip: {
				use: tooltip,
				formatGroup: (grouped: readonly ChartPoint<AccountTrendPoint>[]) => {
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
		}));
	}, [rows, series, styles, low, high, showZero]);
	if (!series.length || !rows.length) {
		return (
			<p className="m-0 text-sm text-muted-foreground">
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
		<div className="grid gap-2">
			<Chart
				definition={definition}
				ariaLabel="Net worth by account over the trailing window"
				ariaDescription={description}
				height={height ?? 280}
			/>
			<ul
				aria-label="Accounts"
				className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
			>
				{styles.map(({ entry, color, dash }) => (
					<li key={entry.id} className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className="block h-0.5 w-7"
							style={{
								backgroundColor: dash ? undefined : color,
								backgroundImage: dashImage(dash, color),
							}}
						/>
						{entry.name}
					</li>
				))}
			</ul>
		</div>
	);
}
