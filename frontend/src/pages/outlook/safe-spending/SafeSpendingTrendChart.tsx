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
	money,
	monthDay,
} from "../../../domain/format.ts";
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";
import { cn } from "@/lib/utils.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

function paceLabel(
	trend: SafeSpendingTrend,
	historical: boolean,
): {
	text: string | null;
	tone: "normal" | "warning" | "danger";
} {
	const limitName = historical ? "historical budget" : "limit";
	if (trend.limitHit) {
		return {
			text: trend.limitHit.projected
				? `${historical ? "Budget" : "Limit"} ~ ${monthDay(trend.limitHit.date)}`
				: `Over ${limitName}`,
			tone: "danger",
		};
	}
	if (trend.safetyNetHit) {
		return {
			text: trend.safetyNetHit.projected
				? `Reserve ~ ${monthDay(trend.safetyNetHit.date)}`
				: "Using reserve",
			tone: "warning",
		};
	}
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

/**
 * Card spending pace. The solid line is recorded spending through today, the
 * dashed continuation is the average daily rate carried to cycle end, and the
 * horizontal rules mark the protected reserve and the spending threshold.
 * Open statements call the threshold the card spending limit; closed
 * statements call it the historical budget. Colors match the list dividers
 * that mark the same crossings.
 */
export function SafeSpendingTrendChart({
	trend,
	showThresholds = true,
	historical = false,
}: {
	trend: SafeSpendingTrend;
	/** Closed statements compare historical spending; the open-tab limits do not apply. */
	showThresholds?: boolean;
	/** Label the threshold as the closed cycle's historical budget. */
	historical?: boolean;
}) {
	const actual = trend.actual;
	const projected = trend.projected;
	const lastActual = actual.at(-1);
	const high = useMemo(() => {
		const values = [
			0,
			...actual.map((point) => point.spent),
			...projected.map((point) => point.spent),
			...(showThresholds ? [trend.limit, trend.safetyNet] : []),
		].filter((value) => Number.isFinite(value));
		return Math.max(1, ...values) * 1.08;
	}, [actual, projected, showThresholds, trend.limit, trend.safetyNet]);
	const definition = useMemo(
		() =>
			defineChart({
				marks: [
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
					...(showThresholds && Number.isFinite(trend.limit) && trend.limit > 0
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
									typeof value === "number" ? money(value) : "",
							},
						},
					}),
				],
				scales: {
					x: {
						scale: () => scalePoint<string>().padding(0.1),
						axis: {
							ticks: {
								spacing: 80,
								format: (value: string) => monthDay(value),
							},
							tickLabels: { thin: { minGap: 16 } },
						},
					},
					y: {
						scale: scaleLinear().domain([0, high]),
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
						};
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
						return `${dateLabel(date, true)}: ${money(spent)}${datum.projected ? " projected" : ""}`;
					},
				},
			}),
		[
			actual,
			projected,
			showThresholds,
			trend.limit,
			trend.safetyNet,
			trend.limitHit,
			lastActual,
			high,
		],
	);
	if (!actual.length) return null;

	const pace = showThresholds
		? paceLabel(trend, historical)
		: { text: `${money(trend.averageDaily)} a day`, tone: "normal" as const };
	const current = lastActual?.spent ?? 0;
	const limitName = historical ? "historical budget" : "limit";
	const limitText = showThresholds
		? trend.limitHit && trend.limit <= 0
			? historical
				? "The paychecks in this cycle did not cover its bills."
				: "Spending is already over the spending limit."
			: trend.limitHit
				? trend.limitHit.projected
					? `The ${money(trend.limit)} ${limitName} is reached around ${dateLabel(trend.limitHit.date, true)}.`
					: `The ${money(trend.limit)} ${limitName} was crossed on ${dateLabel(trend.limitHit.date, true)}.`
				: trend.limit <= 0
					? historical
						? "The paychecks in this cycle did not cover its bills."
						: "The current income does not cover next month's bills."
					: `The ${money(trend.limit)} ${limitName} is not reached this cycle.`
		: "";
	const description =
		`Card spending reached ${money(current)} by ${dateLabel(lastActual!.date, true)}. ` +
		(trend.averageDaily > 0
			? `The average rate is ${money(trend.averageDaily)} a day. `
			: "") +
		limitText +
		(showThresholds && trend.safetyNet > 0
			? ` The protected reserve starts at ${money(trend.safetyNet)}.`
			: "");

	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="m-0 text-sm text-foreground">{labels.spendingPace}</h3>
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
				{showThresholds && trend.safetyNet > 0 && (
					<li className="flex items-center gap-2">
						{legendSwatch(true, "border-warning-text")}
						{labels.reserveStarts}
					</li>
				)}
				{showThresholds && trend.limit > 0 && (
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
