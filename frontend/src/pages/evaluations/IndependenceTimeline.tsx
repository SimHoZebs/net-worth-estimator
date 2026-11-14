import {
	areaY,
	defineChart,
	dot,
	lineY,
	rect,
	ruleX,
	ruleY,
	text,
} from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";
import type {
	FinancialIndependenceAnalysis,
	IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, isoDate, utcDate } from "@/domain/format.ts";
import { independenceCoveragePoints } from "@/domain/independenceCoverage.ts";

/**
 * Candidate-date coverage, not a forecast of balances after independence.
 * Income fills the base, withdrawal capacity stacks above it, and the line
 * carries total spending coverage. Dates stay proportional because start
 * dates are elapsed time.
 */
export function IndependenceTimeline({
	analysis,
	candidate,
}: {
	analysis: FinancialIndependenceAnalysis;
	candidate: IndependenceCandidate;
}) {
	const startTime = utcDate(analysis.startDate).getTime();
	const last = analysis.candidates.at(-1);
	const endDate = analysis.endDate ?? last?.date ?? analysis.startDate;
	const endTime = Math.max(startTime + 1, utcDate(endDate).getTime());
	const lastTime = last ? utcDate(last.date).getTime() : startTime;
	const tail = lastTime < endTime;
	const points = useMemo(
		() => independenceCoveragePoints(analysis.candidates),
		[analysis.candidates],
	);
	const high = useMemo(
		() => Math.max(1.25, ...points.map((point) => (point.coverage ?? 0) * 1.1)),
		[points],
	);
	const definition = useMemo(() => {
		const coverageAt = (date: string | null) => {
			if (!date) return null;
			const row = analysis.candidates.find((item) => item.date === date);
			if (!row || row.coverage === null) return null;
			return {
				time: utcDate(row.date).getTime(),
				coverage: Math.max(0, row.coverage),
			};
		};
		const firstCoverage = coverageAt(analysis.firstCoverageDate);
		const selfSustaining = coverageAt(analysis.firstSelfSustainingDate);
		const selected =
			candidate.coverage === null
				? null
				: {
						time: utcDate(candidate.date).getTime(),
						coverage: Math.max(0, candidate.coverage),
					};
		return defineChart({
			marks: [
				...(tail
					? [
							rect(
								[
									{
										x1: lastTime,
										x2: endTime,
										y1: 0,
										y2: high,
									},
								],
								{
									x1: "x1",
									x2: "x2",
									y1: "y1",
									y2: "y2",
									fill: "var(--border)",
									fillOpacity: 0.5,
									inset: 0,
								},
							),
						]
					: []),
				ruleY([0], { stroke: "var(--input)" }),
				areaY(points, {
					x: "time",
					y1: 0,
					y2: "income",
					fill: "var(--primary)",
					fillOpacity: 0.7,
				}),
				areaY(points, {
					x: "time",
					y1: "income",
					y2: "coverage",
					fill: "var(--chart-band)",
				}),
				lineY(points, {
					x: "time",
					y: "coverage",
					stroke: "var(--primary)",
					strokeWidth: 2.5,
					lineJoin: "round",
				}),
				ruleY([1], {
					stroke: "var(--muted)",
					strokeDasharray: "5 5",
				}),
				text([{ time: startTime, value: 1, label: "100% · Spending" }], {
					x: "time",
					y: "value",
					text: "label",
					fill: "var(--muted)",
					fontSize: 12,
					anchor: "start",
					dy: -8,
				}),
				...(firstCoverage
					? [
							dot([firstCoverage], {
								x: "time",
								y: "coverage",
								r: 5,
								fill: "var(--card)",
								stroke: "var(--primary)",
								strokeWidth: 2.5,
							}),
						]
					: []),
				...(selfSustaining
					? [
							dot([selfSustaining], {
								x: "time",
								y: "coverage",
								r: 6,
								fill: "var(--primary)",
								stroke: "var(--card)",
								strokeWidth: 2.5,
							}),
						]
					: []),
				ruleX([utcDate(candidate.date).getTime()], {
					stroke: "var(--foreground)",
					strokeDasharray: "2 4",
					strokeOpacity: 0.5,
				}),
				...(selected
					? [
							dot([selected], {
								x: "time",
								y: "coverage",
								r: 4,
								fill: "var(--foreground)",
								stroke: "var(--card)",
								strokeWidth: 2,
							}),
						]
					: []),
			],
			scales: {
				x: {
					scale: scaleLinear().domain([startTime, endTime]),
					axis: {
						line: false,
						ticks: {
							values: [startTime, endTime],
							size: 0,
							format: (value: number) => dateLabel(isoDate(new Date(value))),
						},
					},
				},
				y: {
					scale: scaleLinear().domain([0, high]),
					axis: {
						line: false,
						ticks: {
							values: [0],
							size: 0,
							format: () => "0",
						},
					},
				},
			},
		});
	}, [
		analysis.candidates,
		analysis.firstCoverageDate,
		analysis.firstSelfSustainingDate,
		candidate.coverage,
		candidate.date,
		endTime,
		high,
		lastTime,
		points,
		startTime,
		tail,
	]);
	const tailNote = tail
		? ` Starts after ${dateLabel(last!.date)} need a longer projection for the full ${analysis.evaluationYears === null ? "assessment period" : `${analysis.evaluationYears}-year outlook`}.`
		: "";
	const milestones = [
		analysis.firstCoverageDate
			? `First spending coverage: ${dateLabel(analysis.firstCoverageDate, true)}.`
			: "",
		analysis.firstSelfSustainingDate
			? `Self-sustaining: ${dateLabel(analysis.firstSelfSustainingDate, true)}.`
			: "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div>
			<Chart
				definition={definition}
				ariaLabel="Financial independence spending coverage"
				ariaDescription={
					"Income and withdrawal capacity as a share of annual spending for each possible start date. 100 percent funds one year of spending. " +
					milestones +
					tailNote
				}
				height={240}
			/>
			<div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<span className="h-2 w-3 rounded-md bg-primary" aria-hidden="true" />
					Income
				</span>
				<span className="flex items-center gap-1">
					<span
						className="h-2 w-3 rounded-md border border-primary bg-chart-band"
						aria-hidden="true"
					/>
					Withdrawals
				</span>
				{tail && (
					<span className="ml-auto">
						<span
							className="mr-1 inline-block h-2 w-3 rounded-md bg-border"
							aria-hidden="true"
						/>
						More horizon needed
					</span>
				)}
			</div>
		</div>
	);
}
