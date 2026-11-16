import { areaY, defineChart, dot, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
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
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";
import { cn } from "@/lib/utils.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function paceLabel(
	trend: SafeSpendingTrend,
	historical: boolean,
): {
	text: string | null;
	tone: "normal" | "warning" | "danger";
} {
	const limitName = historical ? "historical budget" : "cash limit";
	const current = trend.actual.at(-1);
	if (trend.limit !== null && (current?.spent ?? 0) > trend.limit) {
		return {
			text: `Over ${limitName}`,
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
			text: `${historical ? "Budget" : "Cash limit"} ~ ${monthDay(futureLimit.date)}`,
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
	historical = false,
): [number, number] {
	const income = historical ? undefined : trend.monthlyIncome;
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
 * Spending pace. The solid line is recorded spending through today, the
 * dashed continuation is the average daily rate carried to cycle end, and the
 * horizontal rules mark the protected reserve and the spending threshold.
 * Open statements call the threshold the current spending limit; closed
 * statements call it the historical budget. Colors match the list dividers
 * that mark the same crossings.
 */
export function SafeSpendingTrendChart({
	trend,
	historical = false,
}: {
	trend: SafeSpendingTrend;
	/** Label the threshold as the closed cycle's historical budget. */
	historical?: boolean;
}) {
	const earned = historical ? undefined : trend.monthlyIncome;
	const earnedLine = useMemo(
		() =>
			earned && earned.coordinate !== null
				? Array.from(
						{ length: daysBetweenInclusive(earned.start, earned.end) },
						(_, days) => ({
							date: shiftDate({ date: earned.start, days }),
							amount: earned.coordinate,
							income: true,
						}),
					)
				: [],
		[earned],
	);
	const showThresholds = trend.limit !== null || trend.safetyNet !== null;
	const actual = trend.actual;
	const projected = trend.projected;
	const scheduledBumps = useMemo(
		() => trend.scheduledBumps ?? [],
		[trend.scheduledBumps],
	);
	const bumpByDate = useMemo(
		() => new Map(scheduledBumps.map((bump) => [bump.date.slice(0, 10), bump])),
		[scheduledBumps],
	);
	const bumpDots = useMemo(
		() =>
			scheduledBumps.flatMap((bump) => {
				const day = bump.date.slice(0, 10);
				const point = projected.find(
					(entry) => entry.date.slice(0, 10) === day,
				);
				return point ? [{ date: day, amount: point.spent }] : [];
			}),
		[scheduledBumps, projected],
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
	const domain = useMemo(
		() => spendingChartDomain(trend, historical),
		[trend, historical],
	);
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
					...(bumpDots.length
						? [
								dot(bumpDots, {
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
				tooltip: {
					use: tooltip,
					format: (point) => {
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
						const bump = bumpByDate.get(date);
						return `${dateLabel(date, true)}: ${exactMoney(spent)}${datum.projected ? " projected" : ""}${bump ? ` incl. ${exactMoney(bump.amount)} recurring` : ""}`;
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
			bumpByDate,
			bumpDots,
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
		? paceLabel(trend, historical)
		: { text: `${money(trend.averageDaily)} a day`, tone: "normal" as const };
	const current = lastActual?.spent ?? 0;
	const limitName = historical ? "historical budget" : "cash limit";
	const limitText =
		showThresholds && trend.limit !== null
			? trend.limitHit && trend.limit <= 0
				? historical
					? "The paychecks in this cycle did not cover its bills."
					: "Spending is already over the spending limit."
				: trend.limitHit
					? trend.limitHit.projected
						? `The ${exactMoney(trend.limit)} ${limitName} is reached around ${dateLabel(trend.limitHit.date, true)}.`
						: `The ${exactMoney(trend.limit)} ${limitName} was crossed on ${dateLabel(trend.limitHit.date, true)}.`
					: trend.limit <= 0
						? historical
							? "The paychecks in this cycle did not cover its bills."
							: "The current cash-backed budget is already exhausted at cycle entry."
						: `The ${exactMoney(trend.limit)} ${limitName} is not reached this cycle.`
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
		scheduledBumps
			.map((bump) =>
				bump.name
					? ` Includes ${exactMoney(bump.amount)} ${bump.name} on ${dateLabel(bump.date, true)}.`
					: ` Includes ${exactMoney(bump.amount)} recurring on ${dateLabel(bump.date, true)}.`,
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
				height={190}
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
				{scheduledBumps.length > 0 && (
					<li className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className="inline-block h-2 w-2 shrink-0 rounded-full bg-chart-5"
						/>
						Recurring charges
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
						{historical ? labels.historicalBudget : labels.spendingLimit}
					</li>
				)}
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
		</div>
	);
}
