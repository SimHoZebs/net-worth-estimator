import { useState } from "react";
import { ColorSwatch } from "@/components/dashboard/charts/ColorSwatch";
import { DataTable, formatCurrency } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

interface ReadOnlyAccountsTableProps {
	accounts: Account[];
	showAdvanced: boolean;
	disabledAccountSet: Set<string>;
	onToggle: (id: string) => void;
}

export function ReadOnlyAccountsTable({
	accounts,
	showAdvanced,
	disabledAccountSet,
	onToggle,
}: ReadOnlyAccountsTableProps) {
	const [search, setSearch] = useState("");

	return (
		<div>
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search accounts..."
			/>
			<DataTable
				title="Accounts"
				description="Tracked signed balances. Checkbox toggles what-if disable (immediate)."
				rows={accounts.filter(
					(a) =>
						!search ||
						a.label.toLowerCase().includes(search.toLowerCase()) ||
						a.id.toLowerCase().includes(search.toLowerCase()),
				)}
				variant="flat"
				columns={[
					...(showAdvanced ? [{ key: "id" as never, label: "ID" }] : []),
					{ key: "label" as never, label: "Account" },
					{
						key: "minBalance" as never,
						label: "Min",
						format: (v: unknown) => (v === NO_FLOOR ? "-" : formatCurrency(v)),
					},
					{
						key: "maxBalance" as never,
						label: "Max",
						format: (v: unknown) =>
							v === NO_CEILING ? "-" : formatCurrency(v),
					},
					{
						key: "color" as never,
						label: "Color",
						render: (_v: unknown, row: object) => (
							<ColorSwatch color={(row as Account).color} />
						),
					},
					{
						key: "enabled" as never,
						label: "Enabled",
						render: (_v: unknown, row: object) => {
							const a = row as Account;
							return (
								<input
									type="checkbox"
									className="h-4 w-4 rounded accent-slate-700"
									checked={!disabledAccountSet.has(a.id)}
									onChange={() => onToggle(a.id)}
								/>
							);
						},
					},
				]}
			/>
		</div>
	);
}
