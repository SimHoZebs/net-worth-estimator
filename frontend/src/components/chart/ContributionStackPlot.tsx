import {
	areaY,
	colorLegend,
	defineChart,
	ruleY,
	stack,
} from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { useMemo } from "react";
import { stackedAccountRows } from "../../domain/chart.ts";
import { money } from "../../domain/format.ts";
import type { Projection } from "../../domain/result.ts";
import { TextureSprite } from "../texture/TextureSprite.tsx";
import "../texture/texture.css";
import {
	seriesTexture,
	textureFill,
	toneToken,
} from "../texture/texture.ts";

/**
 * Per-account contribution to trailing net worth as a diverging stacked
 * area: assets stack above zero, debts below it, so the distance between
 * the outer edges is the total. Texture repeats the series color identity
 * (never color alone) through the shared pattern sprite. The rows come
 * from the same forward-filled window as the total line, so both views
 * agree on every day. End balances render as text below the plot.
 */
export function ContributionStackPlot({
	points,
	accounts,
	height,
}: {
	points: Projection["points"];
	accounts: ReadonlyArray<{ id: string; name: string }>;
	height?: number;
}) {
	const { rows, series } = useMemo(
		() => stackedAccountRows({ points, accounts }),
		[points, accounts],
	);
	const fills = useMemo(
		() =>
			series.map((entry) => {
				const { tone, pattern } = seriesTexture(entry.colorIndex);
				return { entry, tone, pattern, fill: textureFill(tone, pattern) };
			}),
		[series],
	);
	const definition = useMemo(() => {
		const names = series.map((entry) => entry.name);
		const fillByAccount = new Map(
			fills.map(({ entry, fill }) => [entry.name, fill]),
		);
		return defineChart({
			marks: [
				areaY(rows, {
					x: "day",
					y: "balance",
					color: "account",
					fill: (row) => fillByAccount.get(row.account) ?? toneToken("sage"),
					layout: stack({ offset: "diverging", order: [...names].reverse() }),
					fillOpacity: 0.85,
				}),
				ruleY([0]),
			],
			scales: {
				x: { scale: () => scalePoint<string>().padding(0.1) },
				y: {
					scale: scaleLinear,
					grid: true,
					axis: { label: "Balance (USD)" },
				},
			},
			color: {
				domain: names,
				range: fills.map(({ fill }) => fill),
				legend: colorLegend({ label: "Account" }),
			},
		});
	}, [rows, series, fills]);
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
		`Stacked daily balances for ${series.length} visible accounts ending ` +
		`${money(total)} in total.` +
		(debt ? " Debts stack below zero." : "");
	return (
		<div className="grid gap-3">
			<TextureSprite />
			<Chart
				definition={definition}
				ariaLabel="Net worth by account over the trailing window"
				ariaDescription={description}
				height={height ?? 280}
			/>
		</div>
	);
}
