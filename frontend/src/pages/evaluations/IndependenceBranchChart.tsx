import { defineChart, dot, lineY, ruleX, ruleY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import type { IndependenceCandidate } from "@/domain/financialIndependence.ts";
import { dateLabel, isoDate, money, utcDate } from "@/domain/format.ts";

/**
 * Projected assets for one independence start date. The line carries the
 * trajectory and a vertical rule marks the first spending shortfall. Dates
 * remain proportional on the x axis because the trajectory is elapsed time.
 */
export function IndependenceBranchChart({
	candidate,
}: {
	candidate: IndependenceCandidate;
}) {
	const trajectory = candidate.outcome?.trajectory;
	const failure = candidate.outcome?.firstShortfallDate ?? null;
	const rows = trajectory ?? [];
	const points = useMemo(
		() =>
			(trajectory ?? []).map((row) => ({
				time: utcDate(row.date).getTime(),
				balance: row.balance,
				date: row.date,
			})),
		[trajectory],
	);
	const definition = useMemo(() => {
		const first = points[0];
		const last = points.at(-1);
		if (!first || !last) return null;
		const start = first.time;
		const end = Math.max(start + 1, last.time);
		const peak = Math.max(1, ...points.map((point) => point.balance)) * 1.1;
		const failureTime = failure ? utcDate(failure).getTime() : null;
		return defineChart({
			marks: [
				ruleY([0], { stroke: "var(--line-strong)" }),
				lineY(points, {
					x: "time",
					y: "balance",
					stroke: "var(--primary)",
					strokeWidth: 2.5,
				}),
				dot([first, last], {
					x: "time",
					y: "balance",
					r: 3.5,
					fill: "var(--primary)",
					stroke: "var(--surface)",
					strokeWidth: 2,
				}),
				...(failureTime === null
					? []
					: [
							ruleX([failureTime], {
								stroke: "var(--danger-solid)",
								strokeWidth: 1,
								strokeDasharray: "4 4",
							}),
						]),
			],
			scales: {
				x: {
					scale: scaleLinear().domain([start, end]),
					axis: {
						line: false,
						ticks: {
							values: [start, end],
							size: 0,
							format: (value: number) =>
								dateLabel(isoDate(new Date(value)), true),
						},
					},
				},
				y: {
					scale: scaleLinear().domain([0, peak]),
					axis: false,
				},
			},
		});
	}, [points, failure]);
	const first = rows[0];
	const last = rows.at(-1);
	if (!definition || !first || !last) return null;
	const description =
		`Projected assets if independence starts on ${dateLabel(candidate.date, true)}: ` +
		`${dateLabel(first.date, true)} to ${dateLabel(last.date, true)}. ` +
		`${money(first.balance)} to ${money(last.balance)}.` +
		(failure ? ` First spending shortfall: ${dateLabel(failure, true)}.` : "");
	const caption = "Projected financial independence asset balances";
	return (
		<figure className="m-0 mt-3">
			<figcaption className="text-xs text-muted">
				Assets after the independence start · nominal dollars
			</figcaption>
			<Chart
				definition={definition}
				ariaLabel={`Projected assets if independence starts in ${dateLabel(candidate.date)}`}
				ariaDescription={description}
				height={170}
				className="mt-2"
			/>
			<details className="mt-2 text-xs text-muted">
				<summary className="cursor-pointer py-2">Projected balances</summary>
				<div
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table.
					tabIndex={0}
					role="region"
					aria-label={caption}
					className="relative max-w-full overflow-x-auto"
				>
					<Table className="w-full border-collapse text-left text-sm">
						<TableCaption className="sr-only">{caption}</TableCaption>
						<TableHeader className="border-b border-line bg-surface-2 text-muted">
							<TableRow className="border-b border-line last:border-b-0 hover:bg-transparent">
								{["Date", "Selected assets"].map((column) => (
									<TableHead
										key={column}
										scope="col"
										className="h-auto border-0 px-5 py-4 font-medium whitespace-nowrap text-xs text-muted"
									>
										{column}
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow
									key={row.date}
									className="border-b border-line last:border-b-0 hover:bg-transparent"
								>
									<TableHead
										scope="row"
										className="h-auto border-0 px-5 py-4 font-medium whitespace-nowrap text-sm text-inherit"
									>
										{dateLabel(row.date, true)}
									</TableHead>
									<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
										{money(row.balance)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</details>
		</figure>
	);
}
