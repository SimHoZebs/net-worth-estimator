import { useId, useMemo } from "react";
import { fundingGapChartModel } from "../../domain/chart.ts";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import type { FundingGap } from "../../domain/fundingGaps.ts";
import { useMediaQuery, viewportQueries } from "../../state/useMediaQuery.ts";

/**
 * Projected account balance leading to a funding gap, plus the refused
 * payment as an explanatory red vector. Renders through the same plot
 * conventions as the Outlook projection chart: model-driven scales, token
 * strokes, gridlines with compact axis labels, and haloed endpoint dots.
 * The refused payment is never posted.
 */
export function BalancePathChart({ gap }: { gap: FundingGap }) {
	const narrow = useMediaQuery(viewportQueries.belowSm);
	const id = useId().replaceAll(":", "");
	const model = useMemo(
		() => fundingGapChartModel({ gap, narrow }),
		[gap, narrow],
	);
	const { summary } = model;
	const ticks = useMemo(() => {
		const dates = model.balances.map((_, index) =>
			index === 0
				? gap.windowStartDate
				: (summary.rows[index - 1]?.date ?? gap.date),
		);
		const at = (fraction: number) => {
			const index = Math.round(fraction * model.balances.length);
			return {
				x: model.x(index),
				label: dateLabel(
					index >= model.balances.length
						? gap.date
						: (dates[index] ?? gap.date),
					true,
				),
				anchor: fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
			} as const;
		};
		return model.balances.length > 2
			? [at(0), at(0.5), at(1)].filter(
					(tick, index, all) =>
						index === 0 || tick.label !== all[index - 1]?.label,
				)
			: [at(0), at(1)];
	}, [model, gap.windowStartDate, gap.date, summary.rows]);
	return (
		<div className="mt-4">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h3 className="text-sm">Account balance over time</h3>
				<span className="text-xs whitespace-nowrap text-muted">
					Through {money(summary.available)} available
				</span>
			</div>
			<svg
				className="block h-auto w-full"
				viewBox={`0 0 ${model.width} ${model.height}`}
				role="img"
				aria-labelledby={`${id}-title ${id}-description`}
			>
				<title id={`${id}-title`}>Account balance over time</title>
				<desc id={`${id}-description`}>
					Balance starts at {money(gap.openingBalance)}, moves to{" "}
					{money(summary.available)} before the payment, and would fall to{" "}
					{money(model.hypothetical)} if the refused payment were forced. A
					horizontal line marks zero.
				</desc>
				<defs>
					<linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="0%"
							className="[stop-color:var(--chart-band)]"
							stopOpacity=".55"
						/>
						<stop
							offset="100%"
							className="[stop-color:var(--chart-band)]"
							stopOpacity=".1"
						/>
					</linearGradient>
				</defs>
				{model.grid.map((value) => (
					<g key={value}>
						<line
							x1={model.left}
							x2={model.width - model.right}
							y1={model.y(value)}
							y2={model.y(value)}
							className="stroke-line"
							strokeDasharray="3 5"
						/>
						<text
							x={model.left - 14}
							y={model.y(value) + 4}
							textAnchor="end"
							className="fill-muted text-xs max-sm:text-sm"
						>
							{compactMoney(value)}
						</text>
					</g>
				))}
				<path d={model.areaPath} fill={`url(#${id}-fill)`} />
				<path
					d={model.balancePath}
					fill="none"
					className="stroke-primary"
					strokeWidth="3"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				<g>
					<line
						x1={model.left}
						x2={model.width - model.right}
						y1={model.baseline}
						y2={model.baseline}
						className="stroke-muted"
						strokeWidth="1.5"
						strokeDasharray="6 6"
					/>
					<text
						x={model.width - model.right - 6}
						y={model.baseline - 6}
						textAnchor="end"
						className="fill-muted text-xs max-sm:text-sm"
					>
						$0 threshold
					</text>
				</g>
				<line
					x1={model.failX}
					x2={model.failX}
					y1={model.top}
					y2={model.height - model.bottom}
					className="stroke-danger-solid"
					strokeWidth="1"
					strokeDasharray="5 5"
					opacity=".6"
				/>
				<path
					d={model.refusalPath}
					fill="none"
					className="stroke-danger-solid"
					strokeWidth="4"
					strokeLinecap="round"
				/>
				<circle
					cx={model.endX}
					cy={model.endY}
					r="5"
					className="fill-primary stroke-surface"
					strokeWidth="3"
				/>
				<circle
					cx={model.failX}
					cy={model.failY}
					r="6"
					className="fill-danger-solid stroke-surface"
					strokeWidth="3"
				/>
				<text
					x={model.failX - 6}
					y={Math.max(20, model.failY - 12)}
					className="fill-danger-text stroke-surface text-xs font-bold"
					textAnchor="end"
					strokeWidth="3"
					paintOrder="stroke"
				>
					−{money(summary.shortfall)}
				</text>
				{ticks.map((tick) => (
					<text
						key={`${tick.x}-${tick.label}`}
						x={tick.x}
						y={model.height - 9}
						textAnchor={tick.anchor}
						className="fill-muted text-xs max-sm:text-sm"
					>
						{tick.label}
					</text>
				))}
			</svg>
		</div>
	);
}
