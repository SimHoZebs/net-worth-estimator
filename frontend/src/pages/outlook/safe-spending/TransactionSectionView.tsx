import { TransactionRow } from "../../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../../components/activity/TransactionTable.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { exactMoney } from "../../../domain/format.ts";
import type { Movement } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";

export function SafeSpendingSectionHeader({
	title,
	subtitle,
	total,
}: {
	title: string;
	subtitle?: string;
	total?: number;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<h3 className="m-0 text-xs font-semibold text-ink">{title}</h3>
				{subtitle && (
					<p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
				)}
			</div>
			{total !== undefined && (
				<strong className="text-sm font-bold tabular-nums">
					{exactMoney(total)}
				</strong>
			)}
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
			<div className="border-t border-line pt-3">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	return (
		<TransactionTable
			className="border-t-0"
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
