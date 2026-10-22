import { useId, useMemo, useState } from "react";
import { nearestPointIndex, projectionChartModel } from "../domain/chart.ts";
import { dateLabel, money, todayIso } from "../domain/format.ts";
import { type Plan, visibleAccounts } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import { AccountDot } from "./AccountIcon.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { Skeleton, Toggle } from "./ui.tsx";

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
	const narrow = useMediaQuery(viewportQueries.belowSm);
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
	const defaultIndex = useMemo(
		() => (model ? nearestPointIndex(model.points, todayIso()) : 0),
		[model],
	);
	const selectedIndex = model
		? Math.min(inspected ?? defaultIndex, model.points.length - 1)
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
			<section
				className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
				aria-label="Net worth over time"
			>
				<div className="flex items-center justify-between gap-4 px-6 pt-6 max-xl:items-start sm:max-xl:px-5 max-sm:gap-3 max-sm:px-4 max-sm:pt-5 max-sm:flex-wrap">
					<h2 className="max-sm:text-sm">Net worth over time</h2>
					<div
						className="inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
						role="toolbar"
						aria-label="Projection horizon"
					>
						{[10, 20, 30].map((year) => (
							<button
								className="rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs sm:max-xl:px-2 max-sm:p-1"
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
				<div className="flex items-center justify-between px-6 pt-6 pb-4 sm:max-xl:px-5 max-sm:px-4 max-sm:pt-5 max-sm:pb-2 max-sm:flex-wrap max-sm:gap-3">
					<div className="flex flex-wrap items-center gap-4 text-xs text-muted max-sm:gap-3">
						<span className="flex items-center gap-2">
							<i className="inline-block h-0.5 w-4 bg-primary" />
							Base case
						</span>
						{ranges && (
							<span className="flex items-center gap-2">
								<i className="inline-block h-2 w-3 rounded-control bg-chart-band" />
								80% of scenarios
							</span>
						)}
						<span className="flex items-center gap-2">
							<i className="inline-block h-0 w-4 border-t-2 border-muted" />
							$0 · no debt
						</span>
					</div>
					<Toggle label="Show range" checked={ranges} onChange={setRanges} />
				</div>
				<div aria-busy="true">
					<Skeleton className="h-56 w-full" />
				</div>
			</section>
		);
	}
	return (
		<section
			className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
			aria-labelledby={`${id}-title`}
		>
			<div className="flex items-center justify-between gap-4 px-6 pt-6 max-xl:items-start sm:max-xl:px-5 max-sm:gap-3 max-sm:px-4 max-sm:pt-5 max-sm:flex-wrap">
				<h2 id={`${id}-title`} className="max-sm:text-sm">
					Net worth over time
				</h2>
				<div
					className="inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
					role="toolbar"
					aria-label="Projection horizon"
				>
					{[10, 20, 30].map((year) => (
						<button
							className="rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs sm:max-xl:px-2 max-sm:p-1"
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
			<div className="flex items-center justify-between px-6 pt-6 pb-4 sm:max-xl:px-5 max-sm:px-4 max-sm:pt-5 max-sm:pb-2 max-sm:flex-wrap max-sm:gap-3">
				<div className="flex flex-wrap items-center gap-4 text-xs text-muted max-sm:gap-3">
					<span className="flex items-center gap-2">
						<i className="inline-block h-0.5 w-4 bg-primary" />
						Base case
					</span>
					{ranges && (
						<span className="flex items-center gap-2">
							<i className="inline-block h-2 w-3 rounded-control bg-chart-band" />
							80% of scenarios
						</span>
					)}
					<span className="flex items-center gap-2">
						<i className="inline-block h-0 w-4 border-t-2 border-muted" />
						$0 · no debt
					</span>
				</div>
				<Toggle label="Show range" checked={ranges} onChange={setRanges} />
			</div>
			<div className="relative grid grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(4)] px-2">
				<ProjectionPlot
					model={model}
					id={id}
					ranges={ranges}
					inspected={inspected}
					selectedIndex={selectedIndex}
					onInspect={setInspected}
				/>
				<input
					className="relative col-start-2 row-start-1 h-3 w-full min-w-0 self-end cursor-ew-resize accent-primary opacity-0 focus-visible:opacity-100 print:hidden"
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
					<div
						className="absolute top-[35%] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2 text-xs whitespace-nowrap shadow-overlay"
						role="status"
					>
						{rangeError ? (
							"Range unavailable · base case shown"
						) : (
							<>
								<span
									className="size-3 animate-spin rounded-full border-2 border-line-strong border-t-primary"
									aria-hidden="true"
								/>
								Modeling scenarios · {Math.round(progress * 100)}%
							</>
						)}
					</div>
				)}
			</div>
			<div
				className="mx-5 mt-1 mb-5 flex min-h-15 flex-wrap content-center gap-x-3 gap-y-2 rounded-control bg-surface-2 px-3 py-2 text-xs tabular-nums"
				aria-live="polite"
			>
				<strong>{dateLabel(point.date)}</strong>
				<span className="text-muted">
					Base case{" "}
					<b className="ml-1 text-ink">
						{money(model.adjust(point.total, point.date))}
					</b>
				</span>
				{selectedRange && (
					<span className="text-muted">
						80% range{" "}
						<b className="ml-1 text-ink">
							{money(model.adjust(selectedRange.lower, point.date))} –{" "}
							{money(model.adjust(selectedRange.upper, point.date))}
						</b>
					</span>
				)}
				{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled flex lists. */}
				<ul
					className="m-0 flex basis-full list-none flex-wrap gap-x-4 gap-y-1 p-0"
					role="list"
					aria-label={`Account balances on ${dateLabel(point.date, true)}`}
				>
					{contributions.map((account) => (
						<li
							key={account.id}
							className="inline-flex items-center gap-2 text-muted"
						>
							<AccountDot color={account.color} />
							<span>
								{account.name}
								{account.enabled ? "" : " (excluded)"}
							</span>
							<b className="ml-1 text-ink">{money(account.value)}</b>
						</li>
					))}
				</ul>
				{/* oxlint-enable jsx-a11y/no-redundant-roles */}
			</div>
		</section>
	);
}
