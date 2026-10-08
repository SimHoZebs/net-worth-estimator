import { Table2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { projectionChartModel } from "../domain/chart.ts";
import { dateLabel, money } from "../domain/format.ts";
import { type Plan, visibleAccounts } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { useMediaQuery } from "../state/useMediaQuery.ts";
import { AccountDot } from "./AccountIcon.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { ProjectionTable } from "./chart/ProjectionTable.tsx";
import { IconButton, Toggle } from "./ui.tsx";

export function ProjectionChart({
	plan,
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
	plan: Plan;
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
	const narrow = useMediaQuery("(max-width: 600px)");
	const id = useId().replaceAll(":", "");
	const model = useMemo(
		() =>
			projectionChartModel({ projection, range, inflation, realTerms, narrow }),
		[projection, range, inflation, realTerms, narrow],
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
	if (!model || !point) return null;
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
				<ProjectionTable
					rows={model.rows}
					realTerms={realTerms}
					hasRange={Boolean(range)}
				/>
			)}
		</section>
	);
}
