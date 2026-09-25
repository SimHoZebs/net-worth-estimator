import { ArrowDownToLine, Table2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { compactMoney, dateLabel, money } from "../domain/format.ts";
import type { Projection, RangeResult } from "../domain/projection.ts";
import { download } from "../state/storage.ts";
import { IconButton, Toggle } from "./ui.tsx";

export function ProjectionChart({
	projection,
	range,
	ranges,
	setRanges,
	years,
	setYears,
	progress,
	inflation,
	rangeError,
}: {
	projection: Projection;
	range: RangeResult | null;
	ranges: boolean;
	setRanges: (value: boolean) => void;
	years: number;
	setYears: (value: number) => void;
	progress: number;
	inflation: number;
	rangeError: string | null;
}) {
	const [inspected, setInspected] = useState<number | null>(null);
	const [showTable, setShowTable] = useState(false);
	const [realTerms, setRealTerms] = useState(false);
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 600);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 600px)");
		const update = () => setNarrow(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	const id = useId().replaceAll(":", "");
	const { points } = projection;
	const start = points[0];
	const last = points.at(-1);
	if (!start || !last) return null;
	const adjust = (value: number, date: string) =>
		realTerms
			? value /
				(1 + inflation / 100) **
					((Date.parse(date) - Date.parse(start.date)) / (365.25 * 86400000))
			: value;
	const values = points.map((point) => adjust(point.total, point.date));
	const upper =
		range?.points.map((point) => adjust(point.upper, point.date)) ?? values;
	const lower =
		range?.points.map((point) => adjust(point.lower, point.date)) ?? values;
	const high = Math.max(...upper, ...values, 1) * 1.08;
	const low = Math.min(0, ...lower, ...values);
	const width = narrow ? 440 : 820;
	const height = narrow ? 260 : 280;
	const left = 63;
	const right = 24;
	const top = 15;
	const bottom = 35;
	const x = (index: number) =>
		left + (index / (points.length - 1)) * (width - left - right);
	const y = (value: number) =>
		height - bottom - ((value - low) / (high - low)) * (height - top - bottom);
	const line = (series: number[]) =>
		series
			.map(
				(value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`,
			)
			.join(" ");
	const area = `${line(upper)} ${lower
		.map((value, index) => `L${x(index)},${y(value)}`)
		.reverse()
		.join(" ")} Z`;
	const selectedIndex = Math.min(
		inspected ?? points.length - 1,
		points.length - 1,
	);
	const point = points[selectedIndex] ?? last;
	const selectedRange = range?.points[selectedIndex];
	const dataRows = points.filter(
		(point, index) =>
			index === 0 ||
			index === points.length - 1 ||
			point.date.slice(5, 10) === "12-31",
	);

	return (
		<section className="chart-card" aria-labelledby={`${id}-title`}>
			<div className="section-top chart-top">
				<div>
					<h2 id={`${id}-title`}>The long view</h2>
					<p>Net worth over time</p>
				</div>
				<div
					className="segmented"
					role="toolbar"
					aria-label="Projection horizon"
				>
					{[10, 20, 30].map((year) => (
						<button
							type="button"
							key={year}
							aria-pressed={years === year}
							onClick={() => {
								setYears(year);
								setInspected(null);
							}}
						>
							{year} years
						</button>
					))}
				</div>
			</div>
			<div className="chart-toolbar">
				<div className="chart-legend">
					<span>
						<i className="legend-line" />
						Base case
					</span>
					{ranges && (
						<span>
							<i className="legend-band" />
							80% of scenarios
						</span>
					)}
				</div>
				<Toggle label="Show range" checked={ranges} onChange={setRanges} />
			</div>
			<div className="chart-wrap">
				<svg
					viewBox={`0 0 ${width} ${height}`}
					role="img"
					aria-labelledby={`${id}-title ${id}-description`}
					onPointerMove={(event) => {
						const bounds = event.currentTarget.getBoundingClientRect();
						const relative =
							((event.clientX - bounds.left) / bounds.width) * width;
						setInspected(
							Math.max(
								0,
								Math.min(
									points.length - 1,
									Math.round(
										((relative - left) / (width - left - right)) *
											(points.length - 1),
									),
								),
							),
						);
					}}
					onPointerLeave={() => setInspected(null)}
				>
					<desc id={`${id}-description`}>
						Base-case net worth starts at {money(start.total)} on{" "}
						{dateLabel(start.date, true)} and ends at {money(last.total)} on{" "}
						{dateLabel(last.date, true)}. The table below contains exact annual
						values. Shading, when enabled, shows the 10th to 90th percentiles
						across 400 modeled scenarios.
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
					{ranges && range ? (
						<path d={area} fill="#dde6c7" fillOpacity=".7" />
					) : (
						<path
							d={`${line(values)} L${x(points.length - 1)},${y(low)} L${left},${y(low)} Z`}
							fill={`url(#${id}-fill)`}
						/>
					)}
					{range && (
						<path
							d={line(range.points.map((p) => adjust(p.median, p.date)))}
							fill="none"
							stroke="#8c997c"
							strokeWidth="1.5"
							strokeDasharray="4 5"
						/>
					)}
					<path
						d={line(values)}
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
				<input
					className="chart-keyboard"
					type="range"
					min="0"
					max={points.length - 1}
					value={selectedIndex}
					aria-label="Inspect projection date"
					aria-valuetext={`${dateLabel(point.date)}: ${money(adjust(point.total, point.date))}`}
					onChange={(event) => setInspected(Number(event.target.value))}
					onBlur={() => setInspected(null)}
				/>
				{ranges && !range && (
					<div className="range-loading" role="status">
						{rangeError ? (
							"Range unavailable · base case shown"
						) : (
							<>
								<span className="spinner" />
								Modeling scenarios · {Math.round(progress * 100)}%
							</>
						)}
					</div>
				)}
			</div>
			{inspected !== null && (
				<div className="chart-inspection" aria-live="polite">
					<strong>{dateLabel(point.date)}</strong>
					<span>
						Base case <b>{money(adjust(point.total, point.date))}</b>
					</span>
					{selectedRange && (
						<span>
							80% range{" "}
							<b>
								{money(adjust(selectedRange.lower, point.date))} –{" "}
								{money(adjust(selectedRange.upper, point.date))}
							</b>
						</span>
					)}
				</div>
			)}
			<div className="chart-foot">
				<button
					type="button"
					className="text-button muted"
					onClick={() => setRealTerms(!realTerms)}
				>
					{realTerms ? "Today's dollars" : "Future dollars"}{" "}
					<span className="tiny-caret">⌄</span>
				</button>
				<span className="chart-foot-note">
					{realTerms
						? `${inflation}% inflation adjustment`
						: "Projection from recorded + estimated balances"}
				</span>
				<IconButton
					icon={showTable ? X : Table2}
					label={
						showTable ? "Hide projection table" : "View exact projection values"
					}
					onClick={() => setShowTable(!showTable)}
				/>
			</div>
			{showTable && (
				<div className="chart-data">
					<div className="section-top">
						<h3>
							Annual values · {realTerms ? "today’s dollars" : "future dollars"}
						</h3>
						<button
							type="button"
							className="text-button"
							onClick={() =>
								download({
									name: "waypoint-projection.csv",
									type: "text/csv",
									content: [
										"Date,Base case,10th percentile,Median,90th percentile",
										...dataRows.map((point) => {
											const band = range?.points.find(
												(row) => row.date === point.date,
											);
											return [
												point.date,
												adjust(point.total, point.date).toFixed(2),
												...[band?.lower, band?.median, band?.upper].map(
													(value) =>
														value === undefined
															? ""
															: adjust(value, point.date).toFixed(2),
												),
											].join(",");
										}),
									].join("\n"),
								})
							}
						>
							<ArrowDownToLine size={15} />
							CSV
						</button>
					</div>
					<div className="table-scroll">
						<table>
							<thead>
								<tr>
									<th scope="col">Date</th>
									<th scope="col">Base case</th>
									{range && (
										<>
											<th scope="col">10th percentile</th>
											<th scope="col">Median</th>
											<th scope="col">90th percentile</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{dataRows.map((point) => {
									const band = range?.points.find(
										(row) => row.date === point.date,
									);
									return (
										<tr key={point.date}>
											<th scope="row">{dateLabel(point.date, true)}</th>
											<td>{money(adjust(point.total, point.date))}</td>
											{band && (
												<>
													<td>{money(adjust(band.lower, point.date))}</td>
													<td>{money(adjust(band.median, point.date))}</td>
													<td>{money(adjust(band.upper, point.date))}</td>
												</>
											)}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</section>
	);
}
