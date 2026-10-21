import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { Movement, Plan } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { useMemo, useState } from "react";
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
	const movements = useMemo(
		() => new Map(plan.movements.map((movement) => [movement.id, movement])),
		[plan.movements],
	);
	const [selected, setSelected] = useState<{
		transaction: AccountTransaction;
		movement: Movement;
	} | null>(null);
	const inspect = (transaction: AccountTransaction, movement: Movement) =>
		setSelected({ transaction, movement });
	return (
		<div className="safe-spending-mandatory">
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
			{cycle.note && <p className="section-note">{cycle.note}</p>}
			<div className="table-toolbar">
				<TransactionSortButton
					order={transactionOrder}
					onChange={onTransactionOrderChange}
				/>
			</div>
			<TransactionSectionView
				transactions={cycle.transactions}
				caption={cycle.title}
				emptyMessage={cycle.emptyMessage}
				movements={movements}
				onInspect={inspect}
				order={transactionOrder}
				showHeaders={showHeaders}
			/>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					movement={selected.movement}
					accounts={plan.accounts}
					plan={plan}
					claimRuleName={
						selected.movement.claimRuleId
							? (plan.movements.find(
									(item) => item.id === selected.movement.claimRuleId,
								)?.name ?? null)
							: null
					}
					onClose={() => setSelected(null)}
				/>
			)}
		</div>
	);
}
