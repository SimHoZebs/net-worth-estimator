import { ArrowRightLeft, ListFilter } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	defaultAccountViewFilters,
	filterTransactions,
} from "../../domain/accountActivity.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { TablePagination } from "../DataTable.tsx";
import { useTransactionSelection } from "./useTransactionSelection.ts";
import { EmptyState } from "../EmptyState.tsx";
import { TransactionDetail } from "./TransactionDetail.tsx";
import { TransactionFilters } from "./TransactionFilters.tsx";
import { TransactionRow } from "./TransactionRow.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

const PAGE_SIZE = 10;
export function Transactions({
	occurrences,
	rows,
	accounts,
	startDate,
	readOnly,
	showHeaders = false,
	onEdit,
}: {
	/** Projected/recorded occurrences for the current view. */
	occurrences: AccountTransaction[];
	/** All saved transaction rows (detail mapping, claim names). */
	rows: Transaction[];
	accounts: Account[];
	startDate: string;
	readOnly: boolean;
	showHeaders?: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const [filters, setFilters] = useState<ActivityFilters>(
		defaultAccountViewFilters,
	);
	const [page, setPage] = useState(0);
	const id = useId();
	const filtered = useMemo(
		() => filterTransactions({ transactions: occurrences, filters, startDate }),
		[occurrences, filters, startDate],
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const pageRows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);
	const savedRows = useMemo(
		() => new Map(rows.map((transaction) => [transaction.id, transaction])),
		[rows],
	);
	const { selected, inspect, close } = useTransactionSelection(
		occurrences,
		savedRows,
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
	if (!occurrences.length)
		return (
			<EmptyState
				icon={ArrowRightLeft}
				title="No transactions for this account yet"
				action="Add a planned transaction"
				onAction={() => onEdit({ kind: "transaction", item: null })}
			/>
		);
	return (
		<>
			<TransactionFilters
				filters={filters}
				recordedCount={
					occurrences.filter(
						(transaction) => transaction.source === "historical",
					).length
				}
				totalCount={occurrences.length}
				onChange={update}
			/>
			{filtered.length ? (
				<>
					<TransactionTable
						caption="Transactions involving this account, separated into recorded facts and projected transactions."
						showHeaders={showHeaders}
						scrollId={`${id}-table`}
					>
						{pageRows.map((transaction) => (
							<TransactionRow
								key={transaction.id}
								transaction={transaction}
								planTransaction={
									savedRows.get(transaction.transactionId) ?? null
								}
								onEdit={() => {
									const planTransaction = savedRows.get(
										transaction.transactionId,
									);
									if (planTransaction) inspect(transaction);
								}}
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
					{selected && (
						<TransactionDetail
							transaction={selected.transaction}
							planTransaction={selected.planTransaction}
							accounts={accounts}
							transactions={rows}
							readOnly={readOnly}
							claimRuleName={
								selected.planTransaction.claimRuleId
									? (rows.find(
											(item) =>
												item.id === selected.planTransaction.claimRuleId,
										)?.name ?? null)
									: null
							}
							onClose={close}
						/>
					)}
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
