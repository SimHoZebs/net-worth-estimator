import { defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import {
	accountTrendRows,
	assignAccountDashes,
	netWorthDomain,
} from "../../domain/chart.ts";
import { useMediaQuery, viewportQueries } from "../../state/useMediaQuery.ts";
import {
	compactMoney,
	dateLabel,
	money,
	monthDay,
} from "../../domain/format.ts";
import type { Projection } from "../../domain/result.ts";

/** Every series shares one ink; the dash pattern carries the identity. */
const INK = "var(--primary)";

/**
 * Per-account balances as monochrome lines on one shared scale: every
 * account shares the zero baseline, so slopes and crossings compare
 * directly and debts plot below zero. Series differ by dash pattern only,
 * never by color. The rows come from the same forward-filled window as
 * the total line, so both views agree on every day.
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
	// The rotated axis title costs ~25px of plot width; drop it where the
	// viewport is narrow and let the compact tick labels carry the units.
	const narrow = useMediaQuery(viewportQueries.belowSm);
	const styles = useMemo(() => {
		const dashes = assignAccountDashes(series);
		return series.map((entry, index) => ({
			entry,
			dash: dashes[index],
		}));
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
		// keeps grouping and grouped focus working; paint is one ink.
		const lines = series.map((entry) => {
			const style = dashById.get(entry.id)!;
			return lineY(
				rows.filter((row) => row.account === entry.name),
				{
					x: "date",
					y: "balance",
					color: "account",
					stroke: INK,
					strokeWidth: 2.25,
					lineCap: "round",
					...(style.dash ? { strokeDasharray: style.dash } : {}),
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
						...(narrow ? {} : { label: "Balance (USD)" }),
						ticks: { format: (value: number) => compactMoney(value) },
					},
				},
			},
			color: {
				domain: names,
				// One ink for every series: the range never renders as paint
				// (strokes are explicit) but keeps the scale resolved.
				range: [INK],
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
	}, [rows, series, styles, low, high, showZero, narrow]);
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
		<div className="grid gap-2">
			<ul
				aria-label="Accounts"
				className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
			>
				{styles.map(({ entry, dash }) => (
					<li key={entry.id} className="flex items-center gap-2">
						<svg
							width="28"
							height="12"
							viewBox="0 0 28 12"
							aria-hidden="true"
							focusable="false"
							className="block"
						>
							<line
								x1="0"
								y1="6"
								x2="28"
								y2="6"
								stroke={INK}
								strokeWidth="2.25"
								strokeLinecap="round"
								{...(dash ? { strokeDasharray: dash } : {})}
							/>
						</svg>
						{entry.name}
					</li>
				))}
			</ul>
			<Chart
				definition={definition}
				ariaLabel="Net worth by account over the trailing window"
				ariaDescription={description}
				height={height ?? 280}
			/>
		</div>
	);
}
