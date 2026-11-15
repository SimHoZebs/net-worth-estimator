import { TransactionRow } from "../../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../../components/activity/TransactionTable.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { exactMoney } from "../../../domain/format.ts";
import type { Transaction } from "../../../domain/model.ts";
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
				<h3 className="m-0 text-xs font-semibold text-foreground">{title}</h3>
				{subtitle && (
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{subtitle}
					</p>
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

export interface SpendingLimitDivider {
	/** Exact ledger row which first made shared remaining headroom negative. */
	transactionId: string;
	tone: "warning" | "danger";
	label: string;
}

export function TransactionSectionView({
	transactions,
	caption,
	emptyMessage,
	savedTransactions,
	onInspect,
	order,
	showHeaders = false,
	dividers = [],
	shortfall,
	shortfallLabel,
}: {
	transactions: AccountTransaction[];
	caption: string;
	emptyMessage: string;
	savedTransactions: Map<string, Transaction>;
	onInspect: (
		transaction: AccountTransaction,
		savedTransaction: Transaction,
	) => void;
	order: TransactionOrder;
	showHeaders?: boolean;
	dividers?: SpendingLimitDivider[];
	shortfall?: boolean;
	shortfallLabel?: string;
}) {
	if (!transactions.length) {
		return (
			<div className="border-t border-border pt-3">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	const dividerById = new Map<string, SpendingLimitDivider>();
	for (const divider of dividers) {
		const existing = dividerById.get(divider.transactionId);
		if (!existing || divider.tone === "danger") {
			dividerById.set(divider.transactionId, divider);
		}
	}
	const rows = transactions.map((transaction) => (
		<TransactionRow
			key={transaction.id}
			transaction={transaction}
			savedTransaction={
				savedTransactions.get(transaction.transactionId) ?? null
			}
			onEdit={(savedTransaction) => onInspect(transaction, savedTransaction)}
			divider={dividerById.get(transaction.id)}
			shortfall={shortfall}
			shortfallLabel={shortfallLabel}
		/>
	));
	return (
		<TransactionTable
			className="border-t-0"
			caption={`${caption}, ${order === "oldest" ? "oldest first" : "newest first"}`}
			showHeaders={showHeaders}
		>
			{rows}
		</TransactionTable>
	);
}
