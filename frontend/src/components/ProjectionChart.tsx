import { useId, useMemo, useState } from "react";
import { projectionChartModel } from "../domain/chart.ts";
import { dateLabel, money } from "../domain/format.ts";
import { type Plan, visibleAccounts } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { useMediaQuery } from "../state/useMediaQuery.ts";
import { AccountDot } from "./AccountIcon.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { Toggle } from "./ui.tsx";
import "./chart/ProjectionChart.css";

export function ProjectionChart({
	plan,
	projection,
	range,
	ranges,
	setRanges,
	years,
	setYears,
	progress,
	rangeError,
	pending = false,
}: {
	plan: Plan;
	projection: Projection | null;
	range: RangeResult | null;
	ranges: boolean;
	setRanges: (value: boolean) => void;
	years: number;
	setYears: (value: number) => void;
	progress: number;
	rangeError: string | null;
	pending?: boolean;
}) {
	const [inspected, setInspected] = useState<number | null>(null);
	const narrow = useMediaQuery("(max-width: 600px)");
	const id = useId().replaceAll(":", "");
	const model = useMemo(
		() =>
			projection
				? projectionChartModel({
						projection,
						range,
						inflation: 0,
						realTerms: false,
						narrow,
					})
				: null,
		[projection, range, narrow],
	);
	const selectedIndex = model
		? Math.min(inspected ?? model.points.length - 1, model.points.length - 1)
		: 0;
	const point = model?.points[selectedIndex] ?? model?.last;
	const selectedRange = model ? range?.points[selectedIndex] : undefined;
	const contributions = useMemo(
		() =>
			point && model
				? visibleAccounts(plan.accounts).map((account) => ({
						id: account.id,
						name: account.name,
						color: account.color,
						enabled: account.enabled,
						value: model.adjust(point.balances[account.id] ?? 0, point.date),
					}))
				: [],
		[plan.accounts, model, point],
	);
	if (!model || !point) {
		// Static chrome (title, horizon, legend, toggles) renders regardless;
		// only data slots skeletonize, and only while data is absent.
		if (!pending) return null;
		return (
			<section className="chart-card" aria-label="Net worth over time">
				<div className="section-top chart-top">
					<h2>Net worth over time</h2>
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
						<span>
							<i className="legend-zero" />
							$0 · no debt
						</span>
					</div>
					<Toggle label="Show range" checked={ranges} onChange={setRanges} />
				</div>
				<div aria-busy="true">
					<span
						className="skeleton"
						style={{ width: "100%", height: 220 }}
						aria-hidden="true"
					/>
				</div>
			</section>
		);
	}
	return (
		<section className="chart-card" aria-labelledby={`${id}-title`}>
			<div className="section-top chart-top">
				<h2 id={`${id}-title`}>Net worth over time</h2>
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
					<span>
						<i className="legend-zero" />
						$0 · no debt
					</span>
				</div>
				<Toggle label="Show range" checked={ranges} onChange={setRanges} />
			</div>
			<div className="chart-wrap">
				<ProjectionPlot
					model={model}
					id={id}
					ranges={ranges}
					inspected={inspected}
					selectedIndex={selectedIndex}
					onInspect={setInspected}
				/>
				<input
					className="chart-keyboard"
					type="range"
					min="0"
					max={model.points.length - 1}
					value={selectedIndex}
					aria-label="Inspect projection date"
					aria-valuetext={`${dateLabel(point.date)}: ${money(model.adjust(point.total, point.date))}`}
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
			<div className="chart-inspection" aria-live="polite">
				<strong>{dateLabel(point.date)}</strong>
				<span>
					Base case <b>{money(model.adjust(point.total, point.date))}</b>
				</span>
				{selectedRange && (
					<span>
						80% range{" "}
						<b>
							{money(model.adjust(selectedRange.lower, point.date))} –{" "}
							{money(model.adjust(selectedRange.upper, point.date))}
						</b>
					</span>
				)}
				<ul
					className="chart-accounts"
					aria-label={`Account balances on ${dateLabel(point.date, true)}`}
				>
					{contributions.map((account) => (
						<li key={account.id}>
							<AccountDot color={account.color} />
							<span>
								{account.name}
								{account.enabled ? "" : " (excluded)"}
							</span>
							<b>{money(account.value)}</b>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
