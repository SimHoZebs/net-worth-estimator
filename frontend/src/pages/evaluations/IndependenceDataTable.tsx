import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "@/components/DataTable.tsx";
import type { FinancialIndependenceAnalysis } from "@/domain/financialIndependence.ts";
import { dateLabel, money, percent } from "@/domain/format.ts";

const amount = (value: number | null) => (value === null ? "—" : money(value));

export function IndependenceDataTable({
	analysis,
}: {
	analysis: FinancialIndependenceAnalysis;
}) {
	return (
		<div className="grid gap-3">
			<h3 className="m-0 text-xs font-semibold text-ink">Funding over time</h3>
			<DataTable
				caption="Financial independence funding over time"
				showHeaders
				columns={[
					{ label: "Date" },
					{ label: "Net worth" },
					{ label: "Capacity / year" },
					{ label: "Spending / year" },
					{ label: "Coverage" },
				]}
			>
				{analysis.candidates.map((row) => (
					<TableRow key={row.date}>
						<TableHeader scope="row">{dateLabel(row.date, true)}</TableHeader>
						<TableCell>{amount(row.netWorth)}</TableCell>
						<TableCell>{amount(row.annualCapacity)}</TableCell>
						<TableCell>{amount(row.annualSpending)}</TableCell>
						<TableCell>
							{row.coverage === null ? "—" : percent(row.coverage)}
						</TableCell>
					</TableRow>
				))}
			</DataTable>
		</div>
	);
}
