import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { Movement, Plan } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { useMemo, useState } from "react";
import {
	TransactionSectionView,
	TimingSectionHeader,
} from "./TransactionSectionView.tsx";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { dateLabel } from "../../../domain/format.ts";

export function TimingCyclePanel({
	cycleStart,
	cycleEnd,
	transactions,
	plan,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
}: {
	cycleStart: string;
	cycleEnd: string;
	transactions: AccountTransaction[];
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
		<div className="timing-mandatory">
			<TimingSectionHeader
				title="Card charges in this cycle"
				subtitle={`${dateLabel(cycleStart, true)} to ${dateLabel(cycleEnd, true)}`}
				total={transactions.reduce(
					(total, transaction) => total + transaction.amount,
					0,
				)}
			/>
			<div className="table-toolbar">
				<TransactionSortButton
					order={transactionOrder}
					onChange={onTransactionOrderChange}
				/>
			</div>
			<TransactionSectionView
				transactions={transactions}
				caption="Card charges in this cycle"
				emptyMessage="No charges in this cycle yet."
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
