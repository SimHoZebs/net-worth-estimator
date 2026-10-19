import { ArrowRightLeft, ListFilter } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	defaultAccountViewFilters,
	filterTransactions,
} from "../../domain/accountActivity.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import { TablePagination } from "../DataTable.tsx";
import { EmptyState } from "../ui.tsx";
import { TransactionFilters } from "./TransactionFilters.tsx";
import { TransactionRow } from "./TransactionRow.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

const PAGE_SIZE = 10;
export function Transactions({
	transactions,
	plan,
	showHeaders = false,
	onEdit,
}: {
	transactions: AccountTransaction[];
	plan: Plan;
	horizon: string;
	showHeaders?: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const [filters, setFilters] = useState<ActivityFilters>(
		defaultAccountViewFilters,
	);
	const [page, setPage] = useState(0);
	const id = useId();
	const filtered = useMemo(
		() =>
			filterTransactions({ transactions, filters, startDate: plan.startDate }),
		[transactions, filters, plan.startDate],
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const rows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);
	const movements = new Map(
		plan.movements.map((movement) => [movement.id, movement]),
	);
	const update = (change: Partial<ActivityFilters>) => {
		setFilters((previous) => ({ ...previous, ...change }));
		setPage(0);
	};
	const turnPage = (next: number) => {
		setPage(next);
		document
			.getElementById(`${id}-table`)
			?.scrollIntoView({ block: "nearest" });
	};
	if (!transactions.length)
		return (
			<EmptyState
				icon={ArrowRightLeft}
				title="No transactions for this account yet"
				action="Add a planned transaction"
				onAction={() => onEdit({ kind: "movement", item: null })}
			/>
		);
	return (
		<>
			<TransactionFilters
				filters={filters}
				recordedCount={
					transactions.filter(
						(transaction) => transaction.source === "historical",
					).length
				}
				totalCount={transactions.length}
				onChange={update}
			/>
			{filtered.length ? (
				<>
					<TransactionTable
						caption="Transactions involving this account, separated into recorded facts and projected movements."
						showHeaders={showHeaders}
						scrollId={`${id}-table`}
					>
						{rows.map((transaction) => (
							<TransactionRow
								key={transaction.id}
								transaction={transaction}
								movement={movements.get(transaction.movementId) ?? null}
								onEdit={(item) => onEdit({ kind: "movement", item })}
							/>
						))}
					</TransactionTable>
					<TablePagination
						page={currentPage}
						pageCount={pageCount}
						total={filtered.length}
						pageSize={PAGE_SIZE}
						onPage={turnPage}
					/>
				</>
			) : (
				<EmptyState
					icon={ListFilter}
					title="No matching transactions"
					action="Clear transaction filters"
					onAction={() => update(defaultAccountViewFilters)}
				/>
			)}
		</>
	);
}
