import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { useMemo } from "react";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
} from "./TransactionSectionView.tsx";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import type { SafeSpendingChargeCycle } from "./safeSpendingDetailModel.ts";

export function SafeSpendingCyclePanel({
	cycle,
	accounts,
	transactions,
	readOnly,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
}: {
	cycle: SafeSpendingChargeCycle;
	accounts: Account[];
	/** Saved rules, for the detail view's rule lookups and edit controls. */
	transactions: Transaction[];
	readOnly: boolean;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
	showHeaders?: boolean;
}) {
	const savedById = useMemo(
		() => new Map(transactions.map((saved) => [saved.id, saved])),
		[transactions],
	);
	const { selected, inspect, close } = useTransactionSelection(
		cycle.transactions,
		savedById,
	);
	return (
		<div className="grid content-start gap-4">
			<SafeSpendingSectionHeader
				title={cycle.title}
				total={
					cycle.showTotal
						? cycle.transactions.reduce(
								(total, transaction) => total + transaction.amount,
								0,
							)
						: undefined
				}
			/>
			<div className="flex justify-end">
				<TransactionSortButton
					order={transactionOrder}
					onChange={onTransactionOrderChange}
				/>
			</div>
			<TransactionSectionView
				transactions={cycle.transactions}
				caption={cycle.title}
				emptyMessage={cycle.emptyMessage}
				savedTransactions={savedById}
				onInspect={inspect}
				order={transactionOrder}
				showHeaders={showHeaders}
			/>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					savedTransaction={selected.savedTransaction}
					accounts={accounts}
					transactions={transactions}
					readOnly={readOnly}
					claimRuleName={
						selected.savedTransaction.claimRuleId
							? (transactions.find(
									(item) => item.id === selected.savedTransaction.claimRuleId,
								)?.name ?? null)
							: null
					}
					onClose={close}
				/>
			)}
		</div>
	);
}
