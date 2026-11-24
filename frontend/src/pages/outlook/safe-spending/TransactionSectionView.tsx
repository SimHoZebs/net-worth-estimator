import { TransactionRow } from "../../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../../components/activity/TransactionTable.tsx";
import type { TransferPeerSummary } from "../../../components/activity/TransferLinkSection.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { amountText } from "./amountText.ts";

export function SafeSpendingSectionHeader({
	title,
	subtitle,
	total,
}: {
	title: string;
	subtitle?: string;
	total?: number | null;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
		</div>
	);
}

export function TransactionSectionView({
	transactions,
	caption,
	emptyMessage,
	savedTransactions,
	transferPeers,
	onInspect,
	order,
}: {
	transactions: AccountTransaction[];
	caption: string;
	emptyMessage: string;
	savedTransactions: Map<string, Transaction>;
	transferPeers: Map<string, TransferPeerSummary>;
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
					transferPeer={transferPeers.get(transaction.transactionId) ?? null}
					onEdit={() => onInspect(transaction)}
				/>
			))}
		</TransactionTable>
	);
}
