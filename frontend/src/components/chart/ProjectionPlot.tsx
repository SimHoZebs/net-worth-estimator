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
	onPin,
}: {
	model: ChartModel;
	id: string;
	inspected: number | null;
	selectedIndex: number;
	onInspect: (value: number | null) => void;
	onPin: (value: number) => void;
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
	const selectedPoint = points[selectedIndex];
	const selectedValue = values[selectedIndex] ?? 0;
	const pointAt = (clientX: number, bounds: DOMRect) =>
		model.indexAt((clientX - bounds.left) / bounds.width);
	// The badge sits beside the dot and flips inside the plot bounds: right
	// of the dot when it fits, otherwise left; above unless the top margin
	// would clip it.
	const badgeWidth = 132;
	const badgeHeight = 46;
	const dotX = x(selectedIndex);
	const dotY = y(selectedValue);
	const badgeX =
		dotX + 14 + badgeWidth <= width - right
			? dotX + 14
			: dotX - 14 - badgeWidth;
	const badgeY =
		dotY - 14 - badgeHeight >= top ? dotY - 14 - badgeHeight : dotY + 14;
	// Wide plots earn more date ticks instead of stretching five labels
	// across the extra space: 5 below 560 units, 7 below 800, else 9.
	const tickFractions =
		width < 560
			? [0, 0.25, 0.5, 0.75, 1]
			: width < 800
				? [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]
				: [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1];
	return (
		<svg
			className="col-span-full col-start-1 row-start-1 block min-h-48 w-full cursor-crosshair overflow-visible sm:min-h-64 md:min-h-60 2xl:min-h-72"
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-labelledby={`${id}-description`}
			onPointerMove={(event) => {
				const bounds = event.currentTarget.getBoundingClientRect();
				onInspect(pointAt(event.clientX, bounds));
			}}
			onPointerLeave={() => onInspect(null)}
			onClick={(event) => {
				onPin(pointAt(event.clientX, event.currentTarget.getBoundingClientRect()));
			}}
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
						vectorEffect="non-scaling-stroke"
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
				strokeWidth="2.5"
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
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
						vectorEffect="non-scaling-stroke"
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
			{tickFractions.map((fraction) => {
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
				strokeWidth="2.5"
				vectorEffect="non-scaling-stroke"
			/>
			{inspected !== null && selectedPoint && (
				<g>
					<line
						x1={x(selectedIndex)}
						x2={x(selectedIndex)}
						y1={top}
						y2={height - bottom}
						className="stroke-muted"
						strokeDasharray="4 4"
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={left}
						x2={width - right}
						y1={y(selectedValue)}
						y2={y(selectedValue)}
						className="stroke-muted"
						strokeDasharray="4 4"
						vectorEffect="non-scaling-stroke"
					/>
					<circle
						cx={x(selectedIndex)}
						cy={y(values[selectedIndex] ?? 0)}
						r="5"
						className="fill-primary stroke-surface"
						strokeWidth="2"
						vectorEffect="non-scaling-stroke"
					/>
					<g>
						<rect
							x={badgeX}
							y={badgeY}
							width={badgeWidth}
							height={badgeHeight}
							rx="8"
							className="fill-surface stroke-line"
							strokeWidth="1"
							vectorEffect="non-scaling-stroke"
						/>
						<text
							x={badgeX + badgeWidth / 2}
							y={badgeY + 19}
							textAnchor="middle"
							className="fill-muted text-xs"
						>
							{dateLabel(selectedPoint.date, true)}
						</text>
						<text
							x={badgeX + badgeWidth / 2}
							y={badgeY + 36}
							textAnchor="middle"
							className="fill-ink text-xs font-bold tabular-nums"
						>
							{money(selectedValue)}
						</text>
					</g>
				</g>
			)}
		</svg>
	);
}
