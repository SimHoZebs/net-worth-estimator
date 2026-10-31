import { useId, useMemo } from "react";
import type {
	FinancialIndependenceAnalysis,
	IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel } from "@/domain/format.ts";
import { independenceChartModel } from "@/domain/independenceChart.ts";
import { TextureDefs } from "@/components/texture/TextureDefs.tsx";
import { useMediaQuery, viewportQueries } from "@/state/useMediaQuery.ts";

export function IndependenceTimeline({
	analysis,
	candidate,
}: {
	analysis: FinancialIndependenceAnalysis;
	candidate: IndependenceCandidate;
}) {
	const id = useId();
	const narrow = useMediaQuery(viewportQueries.belowSm);
	const model = useMemo(
		() => independenceChartModel(analysis, narrow),
		[analysis, narrow],
	);
	const { width, height, left, right, top, bottom, x, y } = model;
	const plotEnd = width - right;
	const tail = model.lastX < plotEnd;
	const marker = (date: string | null, solid: boolean) => {
		const row = analysis.candidates.find((item) => item.date === date);
		return row?.coverage !== null && row?.coverage !== undefined ? (
			<circle
				key={date}
				cx={x(row.date)}
				cy={y(Math.max(0, row.coverage))}
				r={solid ? 6 : 5}
				className={
					solid ? "fill-primary stroke-surface" : "fill-surface stroke-primary"
				}
				strokeWidth="2.5"
			>
				<title>
					{solid ? "Self-sustaining" : "First spending coverage"}:{" "}
					{dateLabel(row.date)}
				</title>
			</circle>
		) : null;
	};
	return (
		<div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="block h-auto w-full overflow-visible"
				role="img"
				aria-labelledby={`${id}-title ${id}-description`}
			>
				<title id={`${id}-title`}>
					Financial independence spending coverage
				</title>
				<desc id={`${id}-description`}>
					Income and withdrawal capacity as a share of annual spending for each
					possible start date. 100 percent funds one year of spending.
					{tail
						? ` Starts after ${dateLabel(analysis.candidates.at(-1)!.date)} need a longer projection for the full ${analysis.evaluationYears === null ? "assessment period" : `${analysis.evaluationYears}-year outlook`}.`
						: ""}
				</desc>
				<TextureDefs
					entries={[
						{
							id: `${id}-tail`,
							background: null,
							mark: "var(--line-strong)",
							markOpacity: 1,
							motif: "stripes",
							size: 8,
							width: 2,
						},
						{
							id: `${id}-withdrawals`,
							background: "var(--chart-band)",
							mark: "var(--primary)",
							markOpacity: 0.5,
							motif: "dots",
							size: 7,
							width: 0.9,
						},
					]}
				/>
				{tail && (
					<rect
						x={model.lastX}
						y={top}
						width={plotEnd - model.lastX}
						height={height - top - bottom}
						fill={`url(#${id}-tail)`}
					/>
				)}
				<line
					x1={left}
					x2={plotEnd}
					y1={y(0)}
					y2={y(0)}
					className="stroke-line-strong"
				/>
				<path d={model.incomePath} className="fill-primary" opacity=".7" />
				<path d={model.withdrawalPath} fill={`url(#${id}-withdrawals)`} />
				<path
					d={model.capacityPath}
					fill="none"
					className="stroke-primary"
					strokeWidth="2.5"
					strokeLinejoin="round"
				/>
				<line
					x1={left}
					x2={plotEnd}
					y1={y(1)}
					y2={y(1)}
					className="stroke-muted"
					strokeDasharray="5 5"
				/>
				<text
					x={left}
					y={y(1) - 8}
					className="fill-muted text-xs max-sm:text-sm"
				>
					100% · Spending
				</text>
				<text
					x={left - 8}
					y={y(0) + 4}
					textAnchor="end"
					className="fill-muted text-xs max-sm:text-sm"
				>
					0
				</text>
				{marker(analysis.firstCoverageDate, false)}
				{marker(analysis.firstSelfSustainingDate, true)}
				<line
					x1={x(candidate.date)}
					x2={x(candidate.date)}
					y1={top}
					y2={height - bottom}
					className="stroke-ink"
					strokeDasharray="2 4"
					opacity=".5"
				/>
				{candidate.coverage !== null && (
					<circle
						cx={x(candidate.date)}
						cy={y(Math.max(0, candidate.coverage))}
						r="4"
						className="fill-ink stroke-surface"
						strokeWidth="2"
					/>
				)}
				<text
					x={left}
					y={height - 7}
					className="fill-muted text-xs max-sm:text-sm"
				>
					{dateLabel(analysis.startDate)}
				</text>
				<text
					x={plotEnd}
					y={height - 7}
					textAnchor="end"
					className="fill-muted text-xs max-sm:text-sm"
				>
					{dateLabel(model.endDate)}
				</text>
			</svg>
			<div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
				<span className="flex items-center gap-1">
					<span
						className="h-2 w-3 rounded-control bg-primary"
						aria-hidden="true"
					/>
					Income
				</span>
				<span className="flex items-center gap-1">
					<span
						className="h-2 w-3 rounded-control border border-primary bg-chart-band"
						aria-hidden="true"
					/>
					Withdrawals
				</span>
				{tail && <span className="ml-auto">▧ More horizon needed</span>}
			</div>
		</div>
	);
}
