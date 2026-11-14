import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { useMemo } from "react";
import { money } from "../../../domain/format.ts";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { cn } from "@/lib/utils.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
	type SpendingLimitDivider,
} from "./TransactionSectionView.tsx";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import type { SafeSpendingChargeCycle } from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

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
	const dividers = useMemo<SpendingLimitDivider[]>(() => {
		const items: SpendingLimitDivider[] = [];
		if (cycle.thresholds?.safetyNetDate) {
			items.push({
				date: cycle.thresholds.safetyNetDate,
				tone: "warning",
				label: labels.reserveStarts,
			});
		}
		if (cycle.thresholds?.limitDate) {
			items.push({
				date: cycle.thresholds.limitDate,
				tone: "danger",
				label: labels.spendingLimit,
			});
		}
		return items;
	}, [cycle.thresholds]);
	return (
		<div className="grid content-start gap-4">
			{cycle.summary && (
				<div className="grid gap-1">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted">Spent</span>
							<strong
							className={cn(
								"m-0 text-base font-bold tabular-nums text-ink [overflow-wrap:anywhere]",
							)}
						>
							{cycle.summary.total === null ? "—" : money(cycle.summary.total)}
						</strong>
					</div>
					{cycle.summary.byCard.map((card) => (
						<div
							key={card.id}
							className="flex items-center justify-between gap-3 text-sm"
						>
							<span className="text-muted">{card.name}</span>
							<span className="font-semibold text-ink">
								{card.amount === null ? "—" : money(card.amount)}
							</span>
						</div>
					))}
				</div>
			)}
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
				dividers={dividers}
			/>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					savedTransaction={selected.savedTransaction}
					accounts={accounts}
					transactions={transactions}
					readOnly={readOnly}
					claimScheduleName={
						selected.savedTransaction.claimScheduleId
							? (transactions.find(
									(item) =>
										item.id === selected.savedTransaction.claimScheduleId,
								)?.name ?? null)
							: null
					}
					onClose={close}
				/>
			)}
		</div>
	);
}
