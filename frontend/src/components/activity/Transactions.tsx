import {
	ArrowRightLeft,
	ChevronLeft,
	ChevronRight,
	Info,
	ListFilter,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	defaultActivityFilters,
	filterTransactions,
} from "../../domain/accountActivity.ts";
import { dateLabel } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import { EmptyState, IconButton } from "../ui.tsx";
import { TransactionFilters } from "./TransactionFilters.tsx";
import { TransactionRow } from "./TransactionRow.tsx";

const PAGE_SIZE = 10;
export function Transactions({
	transactions,
	plan,
	horizon,
	onEdit,
}: {
	transactions: AccountTransaction[];
	plan: Plan;
	horizon: string;
	onEdit: (target: EditorTarget) => void;
}) {
	const [filters, setFilters] = useState<ActivityFilters>(
		defaultActivityFilters,
	);
	const [page, setPage] = useState(0);
	const [expanded, setExpanded] = useState<string | null>(null);
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
		setExpanded(null);
	};
	const turnPage = (next: number) => {
		setPage(next);
		setExpanded(null);
		document
			.getElementById(`${id}-table`)
			?.scrollIntoView({ block: "nearest" });
	};
	if (!transactions.length)
		return (
			<EmptyState
				icon={ArrowRightLeft}
				title="No transactions for this account yet"
				description="Recorded movements and scheduled transactions will appear here. Growth and interest are reflected in the balance projection separately."
				action="Add a planned movement"
				onAction={() => onEdit({ kind: "movement", item: null })}
			/>
		);
	return (
		<>
			<TransactionFilters
				filters={filters}
				recordedCount={
					transactions.filter(
						(transaction) => transaction.source === "recorded",
					).length
				}
				totalCount={transactions.length}
				onChange={update}
			/>
			<p className="transaction-context">
				Recorded history + the current base case through {dateLabel(horizon)}.
				Upcoming dates are relative to {dateLabel(plan.startDate, true)}.
			</p>
			{filtered.length ? (
				<>
					<div className="table-scroll" id={`${id}-table`}>
						<table className="account-activity-table">
							<caption className="sr-only">
								Transactions involving this account, separated into recorded
								facts and projected movements.
							</caption>
							<thead>
								<tr>
									<th scope="col" className="transaction-date-column">
										Date
									</th>
									<th scope="col">Transaction</th>
									<th scope="col" className="transaction-amount-column">
										Amount
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((transaction, index) => (
									<TransactionRow
										key={transaction.id}
										transaction={transaction}
										movement={movements.get(transaction.movementId) ?? null}
										open={expanded === transaction.id}
										detailId={`${id}-row-${index}`}
										onToggle={() =>
											setExpanded(
												expanded === transaction.id ? null : transaction.id,
											)
										}
										onEdit={(item) => onEdit({ kind: "movement", item })}
									/>
								))}
							</tbody>
						</table>
					</div>
					<div className="transaction-pagination">
						<span role="status">
							Showing {currentPage * PAGE_SIZE + 1}–
							{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of{" "}
							{filtered.length} transactions
						</span>
						<div>
							<IconButton
								icon={ChevronLeft}
								label="Previous transaction page"
								disabled={currentPage === 0}
								onClick={() => turnPage(currentPage - 1)}
							/>
							<span>
								{currentPage + 1} / {pageCount}
							</span>
							<IconButton
								icon={ChevronRight}
								label="Next transaction page"
								disabled={currentPage === pageCount - 1}
								onClick={() => turnPage(currentPage + 1)}
							/>
						</div>
					</div>
				</>
			) : (
				<EmptyState
					icon={ListFilter}
					title="No matching transactions"
					description="Try another name, date window, or activity type. Your account data is unchanged."
					action="Clear transaction filters"
					onAction={() => update(defaultActivityFilters)}
				/>
			)}
			<div className="transaction-note">
				<Info size={14} aria-hidden="true" />
				<p>
					Recorded history may be incomplete and is already included in the
					starting balance. Projected amounts show the funded portion; growth
					and interest are included in the balance projection separately.
				</p>
			</div>
		</>
	);
}
