import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { Plan } from "../../../domain/model.ts";
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
	plan,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
}: {
	cycle: SafeSpendingChargeCycle;
	plan: Plan;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
	showHeaders?: boolean;
}) {
	const planTransactions = useMemo(
		() =>
			new Map(
				plan.transactions.map((planTransaction) => [
					planTransaction.id,
					planTransaction,
				]),
			),
		[plan.transactions],
	);
	const { selected, inspect, close } = useTransactionSelection(
		cycle.transactions,
		planTransactions,
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
				planTransactions={planTransactions}
				onInspect={inspect}
				order={transactionOrder}
				showHeaders={showHeaders}
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
									(item) => item.id === selected.planTransaction.claimRuleId,
								)?.name ?? null)
							: null
					}
					onClose={close}
				/>
			)}
		</div>
	);
}
