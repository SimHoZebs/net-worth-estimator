import {
	type ChartPoint,
	areaY,
	defineChart,
	dot,
	lineY,
	ruleY,
	text,
} from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import {
	compactMoney,
	dateLabel,
	daysBetweenInclusive,
	exactMoney,
	money,
	monthDay,
	shiftDate,
} from "../../../domain/format.ts";
import type {
	SafeSpendingScheduledIncrease,
	SafeSpendingTrend,
	SafeSpendingTrendPoint,
} from "../../../domain/safeSpendingTrend.ts";
import { cn } from "@/lib/utils.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/** Income rule drawn across the full chart range at the earned coordinate. */
export function incomeRuleLine(trend: SafeSpendingTrend): {
	date: string;
	amount: number;
	income: true;
}[] {
	const earned = trend.monthlyIncome;
	if (!earned || earned.coordinate === null) return [];
	const start = trend.actual[0]?.date;
	const end = trend.projected.at(-1)?.date ?? trend.actual.at(-1)?.date;
	if (!start || !end) return [];
	return Array.from(
		{ length: daysBetweenInclusive(start, end) },
		(_, days) => ({
			date: shiftDate({ date: start, days }),
			amount: earned.coordinate as number,
			income: true as const,
		}),
	);
}

export interface SpendingLineAmountLabel {
	amount: number;
	label: string;
	fill: string;
	dy: number;
}

/** Axis margins leave about this much of the chart height for the vertical plot.
 * Keep in sync with CHART_HEIGHT_PX: it drives both label spacing and mask y. */
const CHART_HEIGHT_PX = 190;
const LABEL_PLOT_HEIGHT_PX = 140;
const LABEL_BASE_DY = 0;
const LABEL_MIN_GAP_PX = 14;

/**
 * Amounts for the horizontal rules that are actually drawn. Each label sits on
 * its own rule. When rules nearly coincide, the lower labels shift down enough
 * to keep the amounts readable instead of colliding.
 */
export function lineAmountLabels(
	trend: SafeSpendingTrend,
	domain: readonly [number, number],
): SpendingLineAmountLabel[] {
	const result: SpendingLineAmountLabel[] = [];
	const earned = trend.monthlyIncome;
	if (
		earned &&
		earned.coordinate !== null &&
		Number.isFinite(earned.coordinate)
	) {
		result.push({
			amount: earned.coordinate,
			label: `${labels.incomeLimit} ${exactMoney(earned.amount)}`,
			fill: "var(--chart-2)",
			dy: LABEL_BASE_DY,
		});
	}
	const showThresholds = trend.limit !== null || trend.safetyNet !== null;
	if (
		showThresholds &&
		trend.safetyNet !== null &&
		Number.isFinite(trend.safetyNet) &&
		trend.safetyNet > 0
	) {
		result.push({
			amount: trend.safetyNet,
			label: `${labels.reserveStarts} ${exactMoney(trend.safetyNet)}`,
			fill: "var(--warning-text)",
			dy: LABEL_BASE_DY,
		});
	}
	if (
		showThresholds &&
		trend.limit !== null &&
		Number.isFinite(trend.limit) &&
		trend.limit > 0
	) {
		result.push({
			amount: trend.limit,
			label: `${labels.spendingLimit} ${exactMoney(trend.limit)}`,
			fill: "var(--danger-solid)",
			dy: LABEL_BASE_DY,
		});
	}
	const span = domain[1] - domain[0];
	if (span > 0) {
		const pixelsPerUnit = LABEL_PLOT_HEIGHT_PX / span;
		const minimumGapAmount = LABEL_MIN_GAP_PX / pixelsPerUnit;
		let previousAmount = Number.POSITIVE_INFINITY;
		for (const label of [...result].sort(
			(left, right) => right.amount - left.amount,
		)) {
			const ceiling = previousAmount - minimumGapAmount;
			if (label.amount > ceiling) {
				label.dy += (label.amount - ceiling) * pixelsPerUnit;
				previousAmount = ceiling;
			} else {
				previousAmount = label.amount;
			}
		}
	}
	return result;
}

/** One dot per bill marker, on the dated total after that day's increases. */
export function recurringIncreaseDots(
	actual: readonly SafeSpendingTrendPoint[],
	projected: readonly SafeSpendingTrendPoint[],
	billMarkers: readonly SafeSpendingScheduledIncrease[],
): { date: string; amount: number }[] {
	return billMarkers.flatMap((increase) => {
		const day = increase.date.slice(0, 10);
		// Projected wins: a bill due today has two points and must land on the
		// late, post-increase one. Only bills already in actual spending fall
		// through to the recorded curve.
		for (const series of [projected, actual]) {
			for (let index = series.length - 1; index >= 0; index--) {
				const entry = series[index];
				if (entry && entry.date.slice(0, 10) === day) {
					return [{ date: day, amount: entry.spent }];
				}
			}
		}
		return [];
	});
}

export function paceLabel(trend: SafeSpendingTrend): {
	text: string | null;
	tone: "normal" | "warning" | "danger";
} {
	const current = trend.actual.at(-1);
	if (trend.limit !== null && (current?.spent ?? 0) > trend.limit) {
		return {
			text: "Over cash limit",
			tone: "danger",
		};
	}
	const futureLimit = trend.projected.find(
		(point) =>
			point.date > (current?.date ?? "") &&
			trend.limit !== null &&
			point.spent > trend.limit,
	);
	if (futureLimit)
		return {
			text: `${labels.spendingLimit} ~ ${monthDay(futureLimit.date)}`,
			tone: "danger",
		};
	if (trend.safetyNet !== null && (current?.spent ?? 0) > trend.safetyNet) {
		return {
			text: "Using reserve",
			tone: "warning",
		};
	}
	const futureReserve = trend.projected.find(
		(point) =>
			point.date > (current?.date ?? "") &&
			trend.safetyNet !== null &&
			point.spent > trend.safetyNet,
	);
	if (futureReserve)
		return {
			text: `Reserve ~ ${monthDay(futureReserve.date)}`,
			tone: "warning",
		};
	return { text: null, tone: "normal" };
}

function legendSwatch(dashed: boolean, tone: string) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-block w-4 shrink-0",
				dashed
					? `border-t-2 [border-top-style:dashed] ${tone}`
					: `h-0.5 rounded-md ${tone}`,
			)}
		/>
	);
}

/** Include signed net spending and ceilings, with room around negative values. */
export function spendingChartDomain(
	trend: SafeSpendingTrend,
): [number, number] {
	const income = trend.monthlyIncome;
	const values = [
		0,
		...trend.actual.map((point) => point.spent),
		...trend.projected.map((point) => point.spent),
		trend.limit,
		trend.safetyNet,
		income?.coordinate ?? null,
		trend.limitHit?.amount ?? null,
		trend.safetyNetHit?.amount ?? null,
		income?.hit?.amount ?? null,
	].filter(
		(value): value is number => value !== null && Number.isFinite(value),
	);
	return [Math.min(0, ...values) * 1.08, Math.max(1, ...values) * 1.08];
}

/**
 * Spending pace. The solid line is recorded spending through the selected
 * day, the dashed continuation is the average daily rate carried to cycle
 * end, and the horizontal rules mark the protected reserve and the cash
 * limit. Colors match the list dividers that mark the same crossings.
 */
export function SafeSpendingTrendChart({
	trend,
}: {
	trend: SafeSpendingTrend;
}) {
	const earned = trend.monthlyIncome;
	const earnedLine = useMemo(() => incomeRuleLine(trend), [trend]);
	const showThresholds = trend.limit !== null || trend.safetyNet !== null;
	const actual = trend.actual;
	const projected = trend.projected;
	const billMarkers = useMemo(
		() => trend.billMarkers ?? [],
		[trend.billMarkers],
	);
	const increaseByDate = useMemo(
		() =>
			new Map(
				billMarkers.map((increase) => [increase.date.slice(0, 10), increase]),
			),
		[billMarkers],
	);
	const increaseDots = useMemo(
		() => recurringIncreaseDots(actual, projected, billMarkers),
		[actual, projected, billMarkers],
	);
	const dates = useMemo(
		() =>
			[
				...new Set(
					[...actual, ...projected, ...earnedLine].map((point) => point.date),
				),
			].sort(),
		[actual, projected, earnedLine],
	);
	const lastActual = actual.at(-1);
	const domain = useMemo(() => spendingChartDomain(trend), [trend]);
	const amountLabels = useMemo(
		() => lineAmountLabels(trend, domain),
		[domain, trend],
	);
	const definition = useMemo(
		() =>
			defineChart(({ width }) => {
				const centerX = width / 2;
				const pixelsPerUnit =
					LABEL_PLOT_HEIGHT_PX / Math.max(0.01, domain[1] - domain[0]);
				const gapPoints = amountLabels.flatMap((label) => {
					const halfWidth = label.label.length * 3 + 4;
					const amount = label.amount - label.dy / pixelsPerUnit;
					return [
						{ x: centerX - halfWidth, amount, group: label.label },
						{ x: centerX + halfWidth, amount, group: label.label },
					];
				});
				return {
					marks: [
						...(earnedLine.length
							? [
									lineY(earnedLine, {
										x: "date",
										y: "amount",
										stroke: "var(--chart-2)",
										strokeWidth: 2,
										strokeDasharray: "10 3 2 3",
									}),
								]
							: []),
						...(earned?.hit
							? [
									dot([earned.hit], {
										x: "date",
										y: "amount",
										r: 5,
										fill: "var(--chart-2)",
										stroke: "var(--card)",
										strokeWidth: 2,
									}),
								]
							: []),
						areaY(actual, {
							x: "date",
							y1: 0,
							y2: "spent",
							fill: "var(--chart-band)",
							fillOpacity: 0.35,
						}),
						lineY(actual, {
							x: "date",
							y: "spent",
							stroke: "var(--primary)",
							strokeWidth: 2.5,
						}),
						...(projected.length > 1
							? [
									lineY(projected, {
										x: "date",
										y: "spent",
										key: (point) => `${point.date}|${point.spent}`,
										stroke: "var(--primary)",
										strokeWidth: 2,
										strokeDasharray: "6 4",
									}),
								]
							: []),
						...(showThresholds &&
						trend.safetyNet !== null &&
						Number.isFinite(trend.safetyNet) &&
						trend.safetyNet > 0
							? [
									ruleY([trend.safetyNet], {
										stroke: "var(--warning-text)",
										strokeWidth: 1.5,
										strokeDasharray: "2 4",
									}),
								]
							: []),
						...(showThresholds &&
						trend.limit !== null &&
						Number.isFinite(trend.limit) &&
						trend.limit > 0
							? [
									ruleY([trend.limit], {
										stroke: "var(--danger-solid)",
										strokeWidth: 1.5,
										strokeDasharray: "6 4",
									}),
								]
							: []),
						...(lastActual
							? [
									dot([lastActual], {
										x: "date",
										y: "spent",
										r: 4,
										fill: "var(--primary)",
										stroke: "var(--card)",
										strokeWidth: 2,
									}),
								]
							: []),
						...(increaseDots.length
							? [
									dot(increaseDots, {
										x: "date",
										y: "amount",
										r: 4,
										fill: "var(--chart-5)",
										stroke: "var(--card)",
										strokeWidth: 2,
									}),
								]
							: []),
						...(showThresholds && trend.limitHit
							? [
									dot([trend.limitHit], {
										x: "date",
										y: "amount",
										r: 5,
										fill: "var(--danger-solid)",
										stroke: "var(--card)",
										strokeWidth: 2.5,
									}),
								]
							: []),
						...(gapPoints.length
							? [
									decorative(
										lineY(gapPoints, {
											x: "x",
											xScale: "gapX",
											y: "amount",
											key: (point) => point.group,
											stroke: "var(--card)",
											strokeWidth: 16,
										}),
									),
								]
							: []),
						...amountLabels.map((label) =>
							decorative(
								text([{ ...label, x: centerX }], {
									x: "x",
									xScale: "gapX",
									y: "amount",
									text: "label",
									fill: label.fill,
									fontSize: 11,
									fontWeight: 600,
									anchor: "middle",
									dy: label.dy,
								}),
							),
						),
						crosshair({
							x: {
								label: {
									format: (value) =>
										typeof value === "string" ? monthDay(value) : "",
								},
							},
							y: {
								label: {
									format: (value) =>
										typeof value === "number" ? exactMoney(value) : "",
								},
							},
						}),
					],
					scales: {
						x: {
							scale: scalePoint<string>().domain(dates).padding(0.1),
							axis: {
								ticks: {
									spacing: 80,
									format: (value: string) => monthDay(value),
								},
								tickLabels: { thin: { minGap: 16 } },
							},
						},
						gapX: {
							scale: scaleLinear().domain([0, width]),
							channel: "x",
							axis: false,
						},
						y: {
							scale: scaleLinear().domain(domain),
							grid: true,
							axis: {
								ticks: { format: (value: number) => compactMoney(value) },
							},
						},
					},
					focus: "nearest-x",
					maxFocusDistance: Number.POSITIVE_INFINITY,
					tooltip: {
						use: tooltip,
						format: (point: ChartPoint) => {
							const datum = point.datum as {
								date?: unknown;
								spent?: unknown;
								amount?: unknown;
								projected?: unknown;
								income?: unknown;
							};
							if (datum.income && earned)
								return `${labels.earnedThisMonth}: ${exactMoney(earned.amount)}`;
							const date =
								typeof datum.date === "string"
									? datum.date.slice(0, 10)
									: String(point.xValue).slice(0, 10);
							const spent =
								typeof datum.spent === "number"
									? datum.spent
									: typeof datum.amount === "number"
										? datum.amount
										: Number(point.yValue);
							const increase = increaseByDate.get(date);
							return `${dateLabel(date, true)}: ${exactMoney(spent)}${datum.projected ? " projected" : ""}${increase ? ` incl. ${exactMoney(increase.amount)} bills` : ""}`;
						},
					},
				};
			}),
		[
			actual,
			dates,
			earned,
			earnedLine,
			projected,
			showThresholds,
			trend.limit,
			trend.safetyNet,
			trend.limitHit,
			lastActual,
			domain,
			increaseByDate,
			increaseDots,
			amountLabels,
		],
	);
	if (trend.spendingAvailable === false)
		return (
			<div className="grid gap-2">
				<h3 className="m-0 text-sm text-foreground">{labels.spendingPace}</h3>
				<p className="m-0 text-xs text-muted-foreground">Spending incomplete</p>
			</div>
		);
	if (!actual.length) return null;

	const pace = showThresholds
		? paceLabel(trend)
		: { text: `${money(trend.averageDaily)} a day`, tone: "normal" as const };
	const current = lastActual?.spent ?? 0;
	const limitText =
		showThresholds && trend.limit !== null
			? trend.limitHit && trend.limit <= 0
				? "Spending is already over the spending limit."
				: trend.limitHit
					? trend.limitHit.projected
						? `The ${exactMoney(trend.limit)} cash limit is reached around ${dateLabel(trend.limitHit.date, true)}.`
						: `The ${exactMoney(trend.limit)} cash limit was crossed on ${dateLabel(trend.limitHit.date, true)}.`
					: trend.limit <= 0
						? "The current cash-backed budget is already exhausted at cycle entry."
						: `The ${exactMoney(trend.limit)} cash limit is not reached this cycle.`
			: "";
	const description =
		`Spending reached ${exactMoney(current)} by ${dateLabel(lastActual!.date, true)}. ` +
		(trend.averageDaily > 0
			? `The average rate is ${money(trend.averageDaily)} a day. `
			: "") +
		limitText +
		(earned
			? ` Income this month: ${exactMoney(earned.amount)}. Spent this month: ${earned.spent === null ? "unavailable" : exactMoney(earned.spent)}.${earned.coordinate === null ? " Income limit unavailable." : earned.hit ? ` Income crossed on ${dateLabel(earned.hit.date, true)}.` : earned.amount < 0 ? " Net monthly income is negative; no spending crossing." : earned.spent !== null && earned.spent > earned.amount ? " Already over monthly income before this cycle." : ""}`
			: "") +
		(showThresholds && trend.safetyNet !== null && trend.safetyNet > 0
			? ` The protected reserve starts at ${exactMoney(trend.safetyNet)}.`
			: "") +
		billMarkers
			.map((increase) =>
				increase.name
					? ` Includes ${exactMoney(increase.amount)} ${increase.name} bill on ${dateLabel(increase.date, true)}.`
					: ` Includes ${exactMoney(increase.amount)} recurring bill on ${dateLabel(increase.date, true)}.`,
			)
			.join("");

	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="m-0 text-sm text-foreground">{labels.spendingPace}</h3>
				{earned && earned.spent !== null && earned.spent > earned.amount && (
					<span className="text-xs text-warning-text">Over monthly income</span>
				)}
				{pace.text !== null && (
					<span
						className={cn(
							"text-xs whitespace-nowrap",
							pace.tone === "danger"
								? "text-danger-text"
								: pace.tone === "warning"
									? "text-warning-text"
									: "text-muted-foreground",
						)}
					>
						{pace.text}
					</span>
				)}
			</div>
			<Chart
				definition={definition}
				ariaLabel={labels.spendingPace}
				ariaDescription={description}
				height={CHART_HEIGHT_PX}
			/>
			{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none grids. */}
			<ul
				className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-xs text-muted-foreground"
				role="list"
				aria-label={`${labels.spendingPace} legend`}
			>
				{earned && earned.coordinate !== null && (
					<li className="flex items-center gap-2">
						<svg
							aria-hidden="true"
							width="24"
							height="4"
							className="shrink-0 text-chart-2"
						>
							<path
								d="M0 2H24"
								stroke="currentColor"
								strokeWidth="2"
								strokeDasharray="10 3 2 3"
							/>
						</svg>
						{labels.incomeLimit}
					</li>
				)}
				<li className="flex items-center gap-2">
					{legendSwatch(false, "bg-primary")}
					{labels.cardSpendingSoFar}
				</li>
				{projected.length > 1 && (
					<li className="flex items-center gap-2">
						{legendSwatch(true, "border-primary")}
						{labels.projectedSpending}
					</li>
				)}
				{billMarkers.length > 0 && (
					<li className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className="inline-block h-2 w-2 shrink-0 rounded-full bg-chart-5"
						/>
						{labels.recurringBills}
					</li>
				)}
				{showThresholds && trend.safetyNet !== null && trend.safetyNet > 0 && (
					<li className="flex items-center gap-2">
						{legendSwatch(true, "border-warning-text")}
						{labels.reserveStarts}
					</li>
				)}
				{showThresholds && trend.limit !== null && trend.limit > 0 && (
					<li className="flex items-center gap-2">
						{legendSwatch(true, "border-danger-solid")}
						{labels.spendingLimit}
					</li>
				)}
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
		</div>
	);
}
