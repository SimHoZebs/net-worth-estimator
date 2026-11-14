import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import type { FinancialIndependenceAnalysis } from "@/domain/financialIndependence.ts";
import { dateLabel, money, percent } from "@/domain/format.ts";

const amount = (value: number | null) => (value === null ? "—" : money(value));

export function IndependenceDataTable({
	analysis,
}: {
	analysis: FinancialIndependenceAnalysis;
}) {
	const columns = [
		"Date",
		"Net worth",
		"Capacity / year",
		"Spending / year",
		"Coverage",
	];
	return (
		<div className="grid gap-3">
			<h3 className="m-0 text-xs font-semibold text-foreground">
				Funding over time
			</h3>
			<Table
				containerProps={{
					role: "region",
					"aria-label": "Financial independence funding over time",
				}}
			>
				<TableCaption className="sr-only">
					Financial independence funding over time
				</TableCaption>
				<TableHeader>
					<TableRow>
						{columns.map((column, index) => (
							<TableHead
								key={column}
								scope="col"
								className={index ? "text-right" : undefined}
							>
								{column}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{analysis.candidates.map((row) => (
						<TableRow key={row.date}>
							<TableHead scope="row">{dateLabel(row.date, true)}</TableHead>
							<TableCell className="text-right">
								{amount(row.netWorth)}
							</TableCell>
							<TableCell className="text-right">
								{amount(row.annualCapacity)}
							</TableCell>
							<TableCell className="text-right">
								{amount(row.annualSpending)}
							</TableCell>
							<TableCell className="text-right">
								{row.coverage === null ? "—" : percent(row.coverage)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
