import type { ChartModel } from "../../domain/chart.ts";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";

export function ProjectionPlot({
	model,
	id,
	ranges,
	inspected,
	selectedIndex,
	onInspect,
}: {
	model: ChartModel;
	id: string;
	ranges: boolean;
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
		medianPath,
		area,
	} = model;
	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-labelledby={`${id}-title ${id}-description`}
			onPointerMove={(event) => {
				const bounds = event.currentTarget.getBoundingClientRect();
				onInspect(model.indexAt((event.clientX - bounds.left) / bounds.width));
			}}
			onPointerLeave={() => onInspect(null)}
		>
			<desc id={`${id}-description`}>
				Base-case net worth starts at {money(start.total)} on{" "}
				{dateLabel(start.date, true)} and ends at {money(last.total)} on{" "}
				{dateLabel(last.date, true)}. The table below contains exact annual
				values. Shading, when enabled, shows the 10th to 90th percentiles across
				400 modeled scenarios.
			</desc>
			<defs>
				<linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#dce6bc" stopOpacity=".55" />
					<stop offset="100%" stopColor="#e9efdb" stopOpacity=".1" />
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
						stroke="#e5e8e0"
						strokeDasharray="3 5"
					/>
					<text
						x={left - 14}
						y={y(value) + 4}
						textAnchor="end"
						className="axis-label"
					>
						{compactMoney(value)}
					</text>
				</g>
			))}
			{ranges && model.hasRange ? (
				<path d={area} fill="#dde6c7" fillOpacity=".7" />
			) : (
				<path d={filledBasePath} fill={`url(#${id}-fill)`} />
			)}
			{medianPath !== null && (
				<path
					d={medianPath}
					fill="none"
					stroke="#8c997c"
					strokeWidth="1.5"
					strokeDasharray="4 5"
				/>
			)}
			<path
				d={basePath}
				fill="none"
				stroke="#315f47"
				strokeWidth="3"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
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
						className="axis-label"
					>
						{points[index]?.date.slice(0, 4)}
					</text>
				);
			})}
			<circle
				cx={x(points.length - 1)}
				cy={y(values.at(-1) ?? 0)}
				r="5"
				fill="#315f47"
				stroke="white"
				strokeWidth="3"
			/>
			{inspected !== null && (
				<g>
					<line
						x1={x(selectedIndex)}
						x2={x(selectedIndex)}
						y1={top}
						y2={height - bottom}
						stroke="#6c8174"
						strokeDasharray="4 4"
					/>
					<circle
						cx={x(selectedIndex)}
						cy={y(values[selectedIndex] ?? 0)}
						r="5"
						fill="#214c3d"
						stroke="white"
						strokeWidth="2"
					/>
				</g>
			)}
		</svg>
	);
}
