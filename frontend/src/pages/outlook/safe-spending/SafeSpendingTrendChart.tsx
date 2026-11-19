import {
	type ChartPoint,
	type ChartValue,
	areaY,
	defineChart,
	dot,
	lineY,
	ruleY,
} from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { Chart } from "@tanstack/charts/react";
import { keyedSelection, whenSelected } from "@tanstack/charts/selection";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, useState } from "react";
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

/** A bill marker resolved onto its plotted dated total. */
export interface BillIncreaseDot {
	date: string;
	amount: number;
	billName: string;
	billAmount: number;
	key: string;
}

/** One dot per bill marker, on the dated total after that day's increases. */
export function recurringIncreaseDots(
	actual: readonly SafeSpendingTrendPoint[],
	projected: readonly SafeSpendingTrendPoint[],
	billMarkers: readonly SafeSpendingScheduledIncrease[],
): BillIncreaseDot[] {
	return billMarkers.flatMap((increase, index) => {
		const day = increase.date.slice(0, 10);
		// Projected wins: a bill due today has two points and must land on the
		// late, post-increase one. Only bills already in actual spending fall
		// through to the recorded curve.
		for (const series of [projected, actual]) {
			for (let position = series.length - 1; position >= 0; position--) {
				const entry = series[position];
				if (entry && entry.date.slice(0, 10) === day) {
					return [
						{
							date: day,
							amount: entry.spent,
							billName: increase.name?.trim() || labels.recurringBills,
							billAmount: increase.amount,
							key: `${day}|${index}`,
						},
					];
				}
			}
		}
		return [];
	});
}

/** The two lines shown when a bill dot is selected. */
export function billSelectionLabel(dot: BillIncreaseDot): {
	nameLine: string;
	totalLine: string;
} {
	return {
		nameLine: `${dot.billName} · ${exactMoney(dot.billAmount)}`,
		totalLine: `Total spent ${exactMoney(dot.amount)}`,
	};
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

/** Axis margins and a fixed chart height keep the plot geometry predictable. */
const CHART_HEIGHT_PX = 190;

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
	const billDots = useMemo(
		() => recurringIncreaseDots(actual, projected, billMarkers),
		[actual, projected, billMarkers],
	);
	const [selectedBillKey, setSelectedBillKey] = useState<string | null>(null);
	const selection = useMemo(
		() =>
			keyedSelection<unknown, string, ChartValue, ChartValue>({
				selected: controlledSignal(selectedBillKey, (next) =>
					setSelectedBillKey(next),
				),
				key: (datum) =>
					(datum as BillIncreaseDot | null | undefined)?.key ?? null,
			}),
		[selectedBillKey],
	);
	const selectedBill = useMemo(
		() => billDots.find((dot) => dot.key === selectedBillKey) ?? null,
		[billDots, selectedBillKey],
	);
	const selectedBillLabel = useMemo(
		() => (selectedBill ? billSelectionLabel(selectedBill) : null),
		[selectedBill],
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
	const definition = useMemo(
		() =>
			defineChart({
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
					...(billDots.length
						? [
								dot(billDots, {
									x: "date",
									y: "amount",
									key: "key",
									id: "bill-increase-dots",
									r: 4,
									fill: "var(--chart-5)",
									stroke: "var(--card)",
									strokeWidth: 2,
								}),
							]
						: []),
					...(billDots.length
						? [
								whenSelected(
									dot(billDots, {
										x: "date",
										y: "amount",
										key: "key",
										id: "bill-increase-dots-selected",
										r: 6,
										fill: "var(--chart-5)",
										stroke: "var(--card)",
										strokeWidth: 2,
									}),
									selection,
								),
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
				selection,
				tooltip: {
					use: tooltip,
					format: (point: ChartPoint) => {
						const datum = point.datum as {
							date?: unknown;
							spent?: unknown;
							amount?: unknown;
							projected?: unknown;
							income?: unknown;
							billName?: unknown;
							billAmount?: unknown;
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
						if (
							typeof datum.billName === "string" &&
							typeof datum.billAmount === "number"
						) {
							return `${dateLabel(date, true)}: ${datum.billName} ${exactMoney(datum.billAmount)} · total ${exactMoney(spent)}`;
						}
						const increase = increaseByDate.get(date);
						return `${dateLabel(date, true)}: ${exactMoney(spent)}${datum.projected ? " projected" : ""}${increase ? ` incl. ${exactMoney(increase.amount)} bills` : ""}`;
					},
				},
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
			billDots,
			selection,
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
				onSelect={(point) => {
					const datum = point?.datum as BillIncreaseDot | null | undefined;
					if (!datum?.key) setSelectedBillKey(null);
				}}
			/>
			<span className="sr-only" role="status">
				{selectedBill && selectedBillLabel
					? `${selectedBillLabel.nameLine} ${selectedBillLabel.totalLine} on ${dateLabel(selectedBill.date, true)}`
					: ""}
			</span>
			{selectedBill && selectedBillLabel && (
				<section
					aria-label="Selected bill"
					className="border-t border-border pt-2"
				>
					<h4 className="m-0 text-sm font-semibold text-foreground">
						{selectedBillLabel.nameLine}
					</h4>
					<p className="m-0 mt-1 text-xs text-muted-foreground">
						{dateLabel(selectedBill.date, true)} · {selectedBillLabel.totalLine}
					</p>
				</section>
			)}
		</div>
	);
}
