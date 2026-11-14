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
			<h3 className="m-0 text-xs font-semibold text-ink">Funding over time</h3>
			<div
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table.
				tabIndex={0}
				role="region"
				aria-label="Financial independence funding over time"
				className="relative max-w-full overflow-x-auto"
			>
				<Table className="w-full border-collapse text-left text-sm">
					<TableCaption className="sr-only">
						Financial independence funding over time
					</TableCaption>
					<TableHeader className="border-b border-line bg-surface-2 text-muted">
						<TableRow className="border-b border-line last:border-b-0 hover:bg-transparent">
							{columns.map((column) => (
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
						{analysis.candidates.map((row) => (
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
									{amount(row.netWorth)}
								</TableCell>
								<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
									{amount(row.annualCapacity)}
								</TableCell>
								<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
									{amount(row.annualSpending)}
								</TableCell>
								<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
									{row.coverage === null ? "—" : percent(row.coverage)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
