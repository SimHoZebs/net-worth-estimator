import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { useMemo } from "react";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { cn } from "@/lib/utils.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
	type SpendingLimitDivider,
} from "./TransactionSectionView.tsx";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import type {
	SafeSpendingChargeCycle,
	SafeSpendingMandatorySection,
} from "./safeSpendingDetailModel.ts";
import { amountText } from "./amountText.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function SafeSpendingCyclePanel({
	cycle,
	cashPayments,
	accounts,
	transactions,
	readOnly,
	transactionOrder,
	onTransactionOrderChange,
}: {
	cycle: SafeSpendingChargeCycle;
	cashPayments?: SafeSpendingMandatorySection;
	accounts: Account[];
	/** Saved rules, for the detail view's rule lookups and edit controls. */
	transactions: Transaction[];
	readOnly: boolean;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
}) {
	const savedById = useMemo(
		() => new Map(transactions.map((saved) => [saved.id, saved])),
		[transactions],
	);
	const { selected, inspect, close } = useTransactionSelection(
		[...cycle.transactions, ...(cashPayments?.transactions ?? [])],
		savedById,
	);
	const dividers = useMemo<SpendingLimitDivider[]>(() => {
		const items: SpendingLimitDivider[] = [];
		if (cycle.thresholds?.incomeTransactionId) {
			items.push({
				transactionId: cycle.thresholds.incomeTransactionId,
				tone: "warning",
				label: labels.earnedThisMonth,
			});
		}
		if (cycle.thresholds?.safetyNetTransactionId) {
			items.push({
				transactionId: cycle.thresholds.safetyNetTransactionId,
				tone: "warning",
				label: labels.reserveStarts,
			});
		}
		if (cycle.thresholds?.limitTransactionId) {
			items.push({
				transactionId: cycle.thresholds.limitTransactionId,
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
						<span className="text-sm text-muted-foreground">Spent</span>
						<strong
							className={cn(
								"m-0 text-base font-bold tabular-nums text-foreground [overflow-wrap:anywhere]",
							)}
						>
							{amountText(cycle.summary.total)}
						</strong>
					</div>
					{cycle.summary.byCard.map((card) => (
						<div
							key={card.id}
							className="flex items-center justify-between gap-3 text-sm"
						>
							<span className="text-muted-foreground">{card.name}</span>
							<span className="font-semibold text-foreground">
								{amountText(card.amount)}
							</span>
						</div>
					))}
				</div>
			)}
			<SafeSpendingSectionHeader title={cycle.title} />
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
				dividers={dividers}
			/>
			{cashPayments && (
				<>
					<SafeSpendingSectionHeader
						title={cashPayments.title}
						subtitle={cashPayments.subtitle}
						total={cashPayments.total}
					/>
					<TransactionSectionView
						transactions={cashPayments.transactions}
						caption={cashPayments.title}
						emptyMessage="No recorded cash payments in this period."
						savedTransactions={savedById}
						onInspect={inspect}
						order={transactionOrder}
					/>
				</>
			)}
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
