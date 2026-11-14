import { useState } from "react";
import { History } from "lucide-react";
import { releaseOccurrence } from "@/api/generated/endpoints.ts";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { refreshTransactions } from "../../state/workspaceResources.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { TransactionRow } from "./TransactionRow.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

/**
 * Pending bank rows stay owner-editable for the occurrence claim even when
 * the row is otherwise read-only, so removal follows the same gate.
 */
function canRemoveOccurrence(transaction: Transaction): boolean {
	return (
		!transaction.readOnly ||
		(transaction.pending === true && transaction.syncOwned === true)
	);
}

/**
 * Transactions that record an occurrence of one schedule, newest first. The
 * claim is the association, so this reads saved transactions rather than the
 * projected occurrence list. The shared transaction table owns the row
 * layout, status badges, and click-through. Each row also offers a direct
 * Remove from history that releases the occurrence without opening the row.
 */
export function ScheduleHistory({
	transactions,
	accounts,
	startDate,
	onSelect,
	readOnly,
}: {
	transactions: Transaction[];
	accounts: Account[];
	startDate: string;
	onSelect: (transaction: Transaction) => void;
	readOnly?: boolean;
}) {
	const [removingId, setRemovingId] = useState<string | null>(null);
	const remove = async (transaction: Transaction) => {
		if (removingId !== null || readOnly) return;
		setRemovingId(transaction.id);
		// Failures reach the workspace toast from the save; the section
		// keeps no inline mirror so one event has one channel.
		await performSave({
			call: () => releaseOccurrence(transaction.id),
			refresh: refreshTransactions,
			failureMessage: "The occurrence could not be removed.",
		});
		setRemovingId(null);
	};
	return (
		<section
			className="mt-4 border-t border-line pt-4"
			aria-label="Recorded transactions"
		>
			<div className="flex items-center gap-2">
				<History size={17} aria-hidden="true" />
				<h3 className="text-sm font-semibold">Recorded transactions</h3>
				{transactions.length > 0 && (
					<Badge variant="secondary">{transactions.length}</Badge>
				)}
			</div>
			{transactions.length === 0 ? (
				<p className="mt-2 text-sm leading-relaxed text-muted">
					No transactions record an occurrence of this schedule yet.
				</p>
			) : (
				<TransactionTable caption="Transactions that record occurrences of this schedule, newest first.">
					{transactions.map((transaction) => (
						<TransactionRow
							key={transaction.id}
							transaction={scheduleTransaction({
								transaction,
								accounts,
								startDate,
								resolved: {
									amount: transaction.amount,
									requested: transaction.amount,
									date: transaction.startDate,
								},
							})}
							savedTransaction={transaction}
							onEdit={onSelect}
							onRemove={
								!readOnly && canRemoveOccurrence(transaction)
									? () => void remove(transaction)
									: undefined
							}
							removing={removingId === transaction.id}
						/>
					))}
				</TransactionTable>
			)}
		</section>
	);
}
