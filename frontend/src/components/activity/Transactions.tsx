import { ArrowRightLeft, ListFilter } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	defaultAccountViewFilters,
	filterTransactions,
} from "../../domain/accountActivity.ts";
import type { Plan } from "../../domain/model.ts";
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
	const planTransactions = new Map(
		plan.transactions.map((transaction) => [transaction.id, transaction]),
	);
	const { selected, inspect, close } = useTransactionSelection(
		transactions,
		planTransactions,
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
				onAction={() => onEdit({ kind: "transaction", item: null })}
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
						caption="Transactions involving this account, separated into recorded facts and projected transactions."
						showHeaders={showHeaders}
						scrollId={`${id}-table`}
					>
						{rows.map((transaction) => (
							<TransactionRow
								key={transaction.id}
								transaction={transaction}
								planTransaction={
									planTransactions.get(transaction.transactionId) ?? null
								}
								onEdit={() => {
									const planTransaction = planTransactions.get(
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
							accounts={plan.accounts}
							plan={plan}
							claimRuleName={
								selected.planTransaction.claimRuleId
									? (plan.transactions.find(
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
