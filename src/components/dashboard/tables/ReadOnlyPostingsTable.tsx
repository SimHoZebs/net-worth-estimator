import { useState } from "react";
import { DataTable, formatCurrency } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { formatFrequency } from "@/lib/format";
import type { Posting } from "@/lib/projection";

interface ReadOnlyPostingsTableProps {
	postings: Posting[];
	showAdvanced: boolean;
	disabledPostingSet: Set<string>;
	onToggle: (id: string) => void;
}

export function ReadOnlyPostingsTable({
	postings,
	showAdvanced,
	disabledPostingSet,
	onToggle,
}: ReadOnlyPostingsTableProps) {
	const [search, setSearch] = useState("");

	return (
		<div>
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search transactions..."
			/>
			<DataTable
				title="Postings"
				description="Scheduled flows. Checkbox applies a temporary change immediately."
				rows={postings.filter(
					(p) =>
						!search ||
						p.label.toLowerCase().includes(search.toLowerCase()) ||
						p.id.toLowerCase().includes(search.toLowerCase()),
				)}
				variant="flat"
				columns={[
					...(showAdvanced ? [{ key: "id" as never, label: "ID" }] : []),
					{ key: "label" as never, label: "Transaction" },
					...(showAdvanced
						? [{ key: "sourceAccountId" as never, label: "Source" }]
						: []),
					{ key: "destinations" as never, label: "To" },
					...(showAdvanced
						? [{ key: "arithmetic" as never, label: "Formula" }]
						: []),
					{
						key: "frequency" as never,
						label: "Freq",
						format: (v: unknown) =>
							v === "once" ? "Once" : formatFrequency(String(v)),
					},
					...(showAdvanced
						? [
								{ key: "annualRate" as never, label: "Rate" },
								{ key: "annualGrowthRate" as never, label: "Growth" },
								{ key: "volatility" as never, label: "Vol" },
							]
						: []),
					{ key: "startDate" as never, label: "Start" },
					{ key: "endDate" as never, label: "End" },
					...(showAdvanced
						? [
								{
									key: "annualCap" as never,
									label: "Cap",
									format: (v: unknown) =>
										v === null ? "-" : formatCurrency(v),
								},
								{ key: "priority" as never, label: "Pri" },
							]
						: []),
					{
						key: "enabled" as never,
						label: "Enabled",
						render: (_v: unknown, row: object) => {
							const p = row as Posting;
							return (
								<input
									type="checkbox"
									className="h-4 w-4 rounded accent-primary"
									checked={!disabledPostingSet.has(p.id)}
									onChange={() => onToggle(p.id)}
								/>
							);
						},
					},
				]}
			/>
		</div>
	);
}
