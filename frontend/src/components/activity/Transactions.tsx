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
import { TransactionAnalysisProvider } from "../analysis/TransactionAnalysis.tsx";

const PAGE_SIZE = 10;
export function Transactions({
	occurrences,
	rows,
	accounts,
	startDate,
	readOnly,
	showHeaders = false,
	onEdit,
	onSourceChange,
	canRequestForecast = false,
	projected,
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
	/** Notifies the dialog when the viewer asks for projected activity. */
	onSourceChange?: (source: ActivityFilters["source"]) => void;
	/**
	 * Saved rules can project for this account even with zero recorded
	 * facts. Keeps the source select available so projected activity
	 * stays requestable; truly empty accounts keep the add-only state.
	 */
	canRequestForecast?: boolean;
	/** Forecast state scoped to projected activity only. */
	projected?: {
		loading: boolean;
		error: string | null;
		requested: boolean;
		retry: () => void;
	};
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
		if (change.source !== undefined) onSourceChange?.(change.source);
	};
	const resetFilters = () => update(defaultAccountViewFilters);
	const turnPage = (next: number) => {
		setPage(next);
		document
			.getElementById(`${id}-table`)
			?.scrollIntoView({ block: "nearest" });
	};
	const showsProjected = filters.source !== "historical";
	if (!occurrences.length && !canRequestForecast)
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
			{showsProjected && projected?.loading ? (
				<p role="status">Loading projected activity…</p>
			) : null}
			{showsProjected && projected?.error ? (
				<p role="alert">
					{projected.error}{" "}
					<button type="button" onClick={projected.retry}>
						Retry forecast
					</button>
				</p>
			) : null}
			{filtered.length ? (
				<>
					<TransactionAnalysisProvider
						postingIds={pageRows.map(
							(transaction) => transaction.transactionId,
						)}
					>
						<TransactionTable
							caption="Transactions involving this account, separated into recorded facts and projected transactions."
							showHeaders={showHeaders}
							scrollId={`${id}-table`}
						>
							{pageRows.map((transaction) => (
								<TransactionRow
									key={transaction.id}
									transaction={transaction}
									savedTransaction={
										savedRows.get(transaction.transactionId) ?? null
									}
									onEdit={() => {
										const savedTransaction = savedRows.get(
											transaction.transactionId,
										);
										if (savedTransaction) inspect(transaction);
									}}
								/>
							))}
						</TransactionTable>
					</TransactionAnalysisProvider>
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
							savedTransaction={selected.savedTransaction}
							accounts={accounts}
							transactions={rows}
							readOnly={readOnly}
							claimRuleName={
								selected.savedTransaction.claimRuleId
									? (rows.find(
											(item) =>
												item.id === selected.savedTransaction.claimRuleId,
										)?.name ?? null)
									: null
							}
							onClose={close}
						/>
					)}
				</>
			) : !occurrences.length ? (
				<EmptyState
					icon={ArrowRightLeft}
					title="No transactions for this account yet"
					action="Add a planned transaction"
					onAction={() => onEdit({ kind: "transaction", item: null })}
				/>
			) : (
				<EmptyState
					icon={ListFilter}
					title="No matching transactions"
					action="Clear transaction filters"
					onAction={resetFilters}
				/>
			)}
		</>
	);
}
