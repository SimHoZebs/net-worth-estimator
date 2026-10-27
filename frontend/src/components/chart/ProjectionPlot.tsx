import type { ChartModel } from "../../domain/chart.ts";
import {
	compactMoney,
	dateLabel,
	money,
	monthDay,
} from "../../domain/format.ts";

export function ProjectionPlot({
	model,
	id,
	inspected,
	selectedIndex,
	onInspect,
}: {
	model: ChartModel;
	id: string;
	inspected: number | null;
	selectedIndex: number;
	onInspect: (value: number | null) => void;
}) {
	const {
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
		points,
		values,
		start,
		last,
		basePath,
		filledBasePath,
	} = model;
	return (
		<svg
			className="col-span-full col-start-1 row-start-1 block min-h-48 w-full overflow-visible sm:min-h-64 md:min-h-60 2xl:min-h-72"
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-labelledby={`${id}-description`}
			onPointerMove={(event) => {
				const bounds = event.currentTarget.getBoundingClientRect();
				onInspect(model.indexAt((event.clientX - bounds.left) / bounds.width));
			}}
			onPointerLeave={() => onInspect(null)}
		>
			<desc id={`${id}-description`}>
				Trailing {points.length}-day net worth ends at {money(last.total)} on{" "}
				{dateLabel(last.date, true)}, starting at {money(start.total)} on{" "}
				{dateLabel(start.date, true)}.
				{low <= 0 && 0 <= high ? " The solid $0 line marks no debt." : ""}
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
			{Array.from(
				{ length: 5 },
				(_, index) => low + ((high - low) * index) / 4,
			).map((value) => (
				<g key={value}>
					<line
						x1={left}
						x2={width - right}
						y1={y(value)}
						y2={y(value)}
						className="stroke-line"
						strokeDasharray="3 5"
					/>
					<text
						x={left - 14}
						y={y(value) + 4}
						textAnchor="end"
						className="fill-muted text-xs max-sm:text-sm"
					>
						{compactMoney(value)}
					</text>
				</g>
			))}
			<path d={filledBasePath} fill={`url(#${id}-fill)`} />
			<path
				d={basePath}
				fill="none"
				className="stroke-primary"
				strokeWidth="3"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
			{low <= 0 && 0 <= high && (
				<g>
					<line
						x1={left}
						x2={width - right}
						y1={y(0)}
						y2={y(0)}
						className="stroke-muted"
						strokeWidth="1.5"
					/>
					<text
						x={width - right - 6}
						y={y(0) - 6}
						textAnchor="end"
						className="fill-muted text-xs max-sm:text-sm"
					>
						No debt · $0
					</text>
				</g>
			)}
			{[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
				const index = Math.round(fraction * (points.length - 1));
				return (
					<text
						key={fraction}
						x={x(index)}
						y={height - 9}
						textAnchor={
							fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"
						}
						className="fill-muted text-xs max-sm:text-sm"
					>
						{points[index] ? monthDay(points[index].date) : ""}
					</text>
				);
			})}
			<circle
				cx={x(points.length - 1)}
				cy={y(values.at(-1) ?? 0)}
				r="5"
				className="fill-primary stroke-surface"
				strokeWidth="3"
			/>
			{inspected !== null && (
				<g>
					<line
						x1={x(selectedIndex)}
						x2={x(selectedIndex)}
						y1={top}
						y2={height - bottom}
						className="stroke-muted"
						strokeDasharray="4 4"
					/>
					<circle
						cx={x(selectedIndex)}
						cy={y(values[selectedIndex] ?? 0)}
						r="5"
						className="fill-primary stroke-surface"
						strokeWidth="2"
					/>
				</g>
			)}
		</svg>
	);
}
