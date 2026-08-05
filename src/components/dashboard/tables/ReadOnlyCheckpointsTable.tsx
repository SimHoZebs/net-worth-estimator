import { useState } from "react";
import {
	createTableColumn,
	DataTable,
	formatCurrency,
} from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { formatDate } from "@/lib/format";
import type { Checkpoint } from "@/lib/projection";

interface ReadOnlyCheckpointsTableProps {
	checkpoints: Checkpoint[];
	showAdvanced: boolean;
	accountLabelById: Map<string, string>;
}

const column = createTableColumn<Checkpoint>();

export function ReadOnlyCheckpointsTable({
	checkpoints,
	showAdvanced,
	accountLabelById,
}: ReadOnlyCheckpointsTableProps) {
	const [search, setSearch] = useState("");
	const normalizedSearch = search.trim().toLowerCase();
	const rows = checkpoints.filter((checkpoint) => {
		const accountLabel =
			accountLabelById.get(checkpoint.AccountId) ?? checkpoint.AccountId;
		return (
			!normalizedSearch ||
			checkpoint.Date.includes(normalizedSearch) ||
			checkpoint.AccountId.toLowerCase().includes(normalizedSearch) ||
			accountLabel.toLowerCase().includes(normalizedSearch)
		);
	});

	return (
		<div>
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search balance checkpoints..."
			/>
			<DataTable
				title="Balance checkpoints"
				description="Absolute end-of-day balances that correct modeled history before later postings continue."
				rows={rows}
				rowKey={(checkpoint) => `${checkpoint.AccountId}:${checkpoint.Date}`}
				emptyText="No balance checkpoints."
				variant="flat"
				columns={[
					column({ key: "Date", label: "As of", format: formatDate }),
					column({
						key: "AccountId",
						label: showAdvanced ? "Account ID" : "Account",
						format: (accountId) =>
							showAdvanced
								? accountId
								: (accountLabelById.get(accountId) ?? accountId),
					}),
					column({
						key: "Balance",
						label: "Observed balance",
						format: formatCurrency,
					}),
				]}
			/>
		</div>
	);
}
