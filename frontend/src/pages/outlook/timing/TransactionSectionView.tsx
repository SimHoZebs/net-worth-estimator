import { TransactionRow } from "../../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../../components/activity/TransactionTable.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { money } from "../../../domain/format.ts";
import type { Movement } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";

export function TimingSectionHeader({
	title,
	subtitle,
	total,
}: {
	title: string;
	subtitle: string;
	total: number;
}) {
	return (
		<div className="section-top">
			<div className="timing-section-title">
				<h3>{title}</h3>
				<p className="section-note">{subtitle}</p>
			</div>
			<strong className="timing-total">{money(total)}</strong>
		</div>
	);
}

export function TransactionSectionView({
	transactions,
	caption,
	emptyMessage,
	movements,
	onInspect,
	order,
	showHeaders = false,
}: {
	transactions: AccountTransaction[];
	caption: string;
	emptyMessage: string;
	movements: Map<string, Movement>;
	onInspect: (transaction: AccountTransaction, movement: Movement) => void;
	order: TransactionOrder;
	showHeaders?: boolean;
}) {
	if (!transactions.length) {
		return (
			<div className="cycle-breakdown">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	return (
		<TransactionTable
			caption={`${caption}, ${order === "oldest" ? "oldest first" : "newest first"}`}
			showHeaders={showHeaders}
		>
			{transactions.map((transaction) => (
				<TransactionRow
					key={transaction.id}
					transaction={transaction}
					movement={movements.get(transaction.movementId) ?? null}
					onEdit={(movement) => onInspect(transaction, movement)}
				/>
			))}
		</TransactionTable>
	);
}
