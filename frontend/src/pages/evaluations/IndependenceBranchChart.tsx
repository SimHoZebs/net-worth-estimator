import { useId } from "react";
import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "@/components/DataTable.tsx";
import { lineChartModel } from "@/domain/chart.ts";
import type { IndependenceCandidate } from "@/domain/financialIndependence.ts";
import { dateLabel, money, utcDate } from "@/domain/format.ts";

export function IndependenceBranchChart({
	candidate,
}: {
	candidate: IndependenceCandidate;
}) {
	const id = useId();
	const rows = candidate.outcome?.trajectory ?? [];
	if (!rows.length) return null;
	const first = rows[0]!;
	const last = rows.at(-1)!;
	const start = utcDate(first.date).getTime();
	const end = utcDate(last.date).getTime();
	const model = lineChartModel({
		xMax: Math.max(1, end - start),
		low: 0,
		high: Math.max(1, ...rows.map((row) => row.balance)) * 1.1,
		width: 520,
		height: 150,
		left: 6,
		right: 6,
		top: 10,
		bottom: 6,
	});
	const x = (date: string) => model.x(utcDate(date).getTime() - start);
	const path = rows
		.map(
			(row, index) =>
				`${index ? "L" : "M"}${x(row.date)},${model.y(row.balance)}`,
		)
		.join(" ");
	const failure = candidate.outcome?.firstShortfallDate;
	return (
		<figure className="m-0 mt-3">
			<figcaption className="text-xs text-muted">
				Assets after the independence start · nominal dollars
			</figcaption>
			<svg
				viewBox="0 0 520 150"
				className="mt-2 block h-auto w-full"
				role="img"
				aria-labelledby={id}
			>
				<title id={id}>
					Projected assets if independence starts in {dateLabel(candidate.date)}
					: {dateLabel(first.date)} to {dateLabel(last.date)}.{" "}
					{money(first.balance)} to {money(last.balance)}.
					{failure ? ` First spending shortfall: ${dateLabel(failure)}.` : ""}
				</title>
				<line
					x1="6"
					x2="514"
					y1={model.y(0)}
					y2={model.y(0)}
					className="stroke-line-strong"
				/>
				<path
					d={path}
					fill="none"
					className="stroke-primary"
					strokeWidth="2.5"
				/>
				{failure && (
					<line
						x1={x(failure)}
						x2={x(failure)}
						y1="10"
						y2="144"
						className="stroke-danger-solid"
						strokeDasharray="4 4"
					/>
				)}
			</svg>
			<div className="mt-1 flex justify-between gap-2 text-xs text-muted">
				<span>{dateLabel(first.date)}</span>
				<span>{dateLabel(last.date)}</span>
			</div>
			<details className="mt-2 text-xs text-muted">
				<summary className="cursor-pointer py-2">Projected balances</summary>
				<DataTable
					caption="Projected financial independence asset balances"
					showHeaders
					columns={[{ label: "Date" }, { label: "Selected assets" }]}
				>
					{rows.map((row) => (
						<TableRow key={row.date}>
							<TableHeader scope="row">{dateLabel(row.date, true)}</TableHeader>
							<TableCell>{money(row.balance)}</TableCell>
						</TableRow>
					))}
				</DataTable>
			</details>
		</figure>
	);
}
