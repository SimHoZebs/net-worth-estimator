import {
	areaY,
	defineChart,
	dot,
	lineY,
	ruleX,
	ruleY,
	text,
} from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import {
	summarizeFundingGap,
	type FundingGap,
} from "../../domain/fundingGaps.ts";

/**
 * Projected account balance leading to a funding gap, plus the refused
 * payment as an explanatory red vector. The refused payment is never posted.
 * X positions stay on transaction slots so the refused extra slot has its own
 * place past the last realized balance.
 */
export function BalancePathChart({ gap }: { gap: FundingGap }) {
	const summary = useMemo(() => summarizeFundingGap(gap), [gap]);
	const balances = useMemo(
		() => [gap.openingBalance, ...summary.rows.map((row) => row.balanceAfter)],
		[gap.openingBalance, summary.rows],
	);
	const hypothetical = summary.projectedBalanceIfExecuted;
	const count = balances.length;
	const definition = useMemo(() => {
		const balanceRows = balances.map((balance, index) => ({ index, balance }));
		const dates = [gap.windowStartDate, ...summary.rows.map((row) => row.date)];
		const dateAt = (index: number) =>
			index >= count ? gap.date : (dates[index] ?? gap.date);
		const tickIndexes =
			count > 2
				? [0, Math.round(count / 2), count].filter(
						(index, position, all) =>
							position === 0 || dateAt(index) !== dateAt(all[position - 1]!),
					)
				: [0, count];
		const peak = Math.max(0, ...balances, hypothetical);
		const floor = Math.min(0, ...balances, hypothetical);
		const span = Math.max(1, peak - floor);
		const high = Math.max(1000, peak) + Math.max(450, span * 0.13);
		const low = floor - Math.max(350, span * 0.09);
		const end = balanceRows[count - 1]!;
		const refusal = [end, { index: count, balance: hypothetical }];
		return defineChart({
			marks: [
				areaY(balanceRows, {
					x: "index",
					y1: low,
					y2: "balance",
					fill: "var(--chart-band)",
					fillOpacity: 0.35,
				}),
				lineY(balanceRows, {
					x: "index",
					y: "balance",
					stroke: "var(--primary)",
					strokeWidth: 3,
				}),
				ruleY([0], {
					stroke: "var(--muted)",
					strokeWidth: 1.5,
					strokeDasharray: "6 6",
				}),
				ruleX([count], {
					stroke: "var(--danger-solid)",
					strokeWidth: 1,
					strokeDasharray: "5 5",
					strokeOpacity: 0.6,
				}),
				lineY(refusal, {
					x: "index",
					y: "balance",
					stroke: "var(--danger-solid)",
					strokeWidth: 4,
				}),
				dot([end], {
					x: "index",
					y: "balance",
					r: 5,
					fill: "var(--primary)",
					stroke: "var(--surface)",
					strokeWidth: 3,
				}),
				dot([refusal[1]!], {
					x: "index",
					y: "balance",
					r: 6,
					fill: "var(--danger-solid)",
					stroke: "var(--surface)",
					strokeWidth: 3,
				}),
				text(
					[
						{
							index: count,
							balance: hypothetical,
							label: `−${money(summary.shortfall)}`,
						},
					],
					{
						x: "index",
						y: "balance",
						text: "label",
						fill: "var(--danger-text)",
						fontSize: 12,
						fontWeight: 700,
						anchor: "end",
						dx: -8,
						dy: -30,
					},
				),
				text([{ index: count, balance: 0, label: "$0 threshold" }], {
					x: "index",
					y: "balance",
					text: "label",
					fill: "var(--muted)",
					fontSize: 12,
					anchor: "end",
					dx: -6,
					dy: -16,
				}),
			],
			scales: {
				x: {
					scale: scaleLinear().domain([0, count]),
					axis: {
						line: false,
						ticks: {
							values: tickIndexes,
							size: 0,
							format: (value: number) => dateLabel(dateAt(value), true),
						},
					},
				},
				y: {
					scale: scaleLinear().domain([low, high]),
					grid: true,
					axis: {
						ticks: { count: 5, format: (value: number) => compactMoney(value) },
					},
				},
			},
		});
	}, [balances, count, gap, hypothetical, summary]);
	const description =
		`Balance starts at ${money(gap.openingBalance)}, moves to ` +
		`${money(summary.available)} before the payment, and would fall to ` +
		`${money(hypothetical)} if the refused payment were forced. A ` +
		`horizontal line marks zero.`;
	return (
		<div className="mt-4">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h3 className="text-sm">Account balance over time</h3>
				<span className="text-xs whitespace-nowrap text-muted">
					Through {money(summary.available)} available
				</span>
			</div>
			<Chart
				definition={definition}
				ariaLabel="Account balance over time"
				ariaDescription={description}
				height={280}
			/>
		</div>
	);
}
