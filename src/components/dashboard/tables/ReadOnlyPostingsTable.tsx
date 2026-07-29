import { useState } from "react";
import {
	createTableColumn,
	DataTable,
	formatCurrency,
} from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { formatFrequency } from "@/lib/format";
import type { Posting } from "@/lib/projection";
import { PostingAmount } from "./PostingAmount";

interface ReadOnlyPostingsTableProps {
	postings: Posting[];
	showAdvanced: boolean;
	disabledPostingSet: Set<string>;
	onToggle: (id: string) => void;
}

const postingColumn = createTableColumn<Posting>();

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
			<DataTable<Posting>
				title="Scheduled transactions"
				description="Recurring income, spending, and transfers tied directly to salary or checking."
				rows={postings.filter(
					(p) =>
						!search ||
						p.label.toLowerCase().includes(search.toLowerCase()) ||
						p.id.toLowerCase().includes(search.toLowerCase()),
				)}
				rowKey={(posting) => posting.id}
				variant="flat"
				columns={[
					...(showAdvanced ? [postingColumn({ key: "id", label: "ID" })] : []),
					postingColumn({ key: "label", label: "Transaction" }),
					...(showAdvanced
						? [postingColumn({ key: "sourceAccountId", label: "Source" })]
						: []),
					postingColumn({ key: "destinations", label: "To" }),
					postingColumn({
						key: "arithmetic",
						label: "Amount",
						render: (value) => <PostingAmount arithmetic={value} />,
					}),
					postingColumn({
						key: "frequency",
						label: "Freq",
						format: (value) =>
							value === "once" ? "Once" : formatFrequency(value),
					}),
					...(showAdvanced
						? [
								postingColumn({ key: "annualRate", label: "Rate" }),
								postingColumn({ key: "annualGrowthRate", label: "Growth" }),
								postingColumn({ key: "volatility", label: "Vol" }),
							]
						: []),
					postingColumn({ key: "startDate", label: "Start" }),
					postingColumn({ key: "endDate", label: "End" }),
					...(showAdvanced
						? [
								postingColumn({
									key: "annualCap",
									label: "Cap",
									format: (value) =>
										value === null ? "-" : formatCurrency(value),
								}),
								postingColumn({ key: "priority", label: "Pri" }),
							]
						: []),
					postingColumn({
						key: "enabled",
						label: "Enabled",
						render: (_value, posting) => {
							return (
								<input
									type="checkbox"
									aria-label={`Enable ${posting.label}`}
									className="h-4 w-4 rounded accent-primary"
									checked={!disabledPostingSet.has(posting.id)}
									onChange={() => onToggle(posting.id)}
								/>
							);
						},
					}),
				]}
			/>
		</div>
	);
}
