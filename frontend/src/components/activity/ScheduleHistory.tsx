import { History } from "lucide-react";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { Badge } from "../Badge.tsx";
import { TransactionRow } from "./TransactionRow.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

/**
 * Postings that record an occurrence of one schedule, newest first. The
 * claim is the association, so this reads saved postings rather than the
 * projected occurrence list. The shared transaction table owns the row
 * layout, status badges, and click-through.
 */
export function ScheduleHistory({
	transactions,
	accounts,
	startDate,
	onSelect,
}: {
	transactions: Transaction[];
	accounts: Account[];
	startDate: string;
	onSelect: (transaction: Transaction) => void;
}) {
	return (
		<section
			className="mt-4 border-t border-line pt-4"
			aria-label="Recorded transactions"
		>
			<div className="flex items-center gap-2">
				<History size={17} aria-hidden="true" />
				<h3 className="text-sm font-semibold">Recorded transactions</h3>
				{transactions.length > 0 && (
					<Badge tone="neutral">{transactions.length}</Badge>
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
									date:
										transaction.claimOccurrenceDate ?? transaction.startDate,
								},
							})}
							savedTransaction={transaction}
							onEdit={onSelect}
						/>
					))}
				</TransactionTable>
			)}
		</section>
	);
}
