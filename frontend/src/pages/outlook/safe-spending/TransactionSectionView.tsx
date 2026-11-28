import { TransactionRow } from "../../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../../components/activity/TransactionTable.tsx";
import type { TransferListState } from "../../../components/activity/useTransferPeers.ts";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { amountText } from "./amountText.ts";

export function SafeSpendingSectionHeader({
	title,
	subtitle,
	total,
	action,
}: {
	title: string;
	subtitle?: string;
	total?: number | null;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<h3 className="m-0 text-xs font-semibold text-foreground">{title}</h3>
				{subtitle && (
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{subtitle}
					</p>
				)}
			</div>
			{total !== undefined && (
				<strong className="text-sm font-bold tabular-nums">
					{amountText(total)}
				</strong>
			)}
			{action && <div className="flex shrink-0 items-center">{action}</div>}
		</div>
	);
}

export function TransactionSectionView({
	transactions,
	caption,
	emptyMessage,
	savedTransactions,
	transferState,
	onInspect,
	order,
}: {
	transactions: AccountTransaction[];
	caption: string;
	emptyMessage: string;
	savedTransactions: Map<string, Transaction>;
	transferState: TransferListState;
	onInspect: (transaction: AccountTransaction) => void;
	order: TransactionOrder;
}) {
	if (!transactions.length) {
		return (
			<div className="border-t border-border pt-3">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	return (
		<TransactionTable
			className="border-t-0"
			caption={`${caption}, ${order === "oldest" ? "oldest first" : "newest first"}`}
		>
			{transactions.map((transaction) => (
				<TransactionRow
					key={transaction.id}
					transaction={transaction}
					savedTransaction={
						savedTransactions.get(transaction.transactionId) ?? null
					}
					transferPeer={
						transferState.peersById.get(transaction.transactionId) ?? null
					}
					hasTransferLink={transferState.linkedIds.has(
						transaction.transactionId,
					)}
					transferLinksLoaded={transferState.loaded}
					onEdit={() => onInspect(transaction)}
				/>
			))}
		</TransactionTable>
	);
}
