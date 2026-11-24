import { useMemo } from "react";
import { TransactionAnalysisProvider } from "../../../components/analysis/TransactionAnalysis.tsx";
import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { useTransferPeers } from "../../../components/activity/useTransferPeers.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { monthDay } from "../../../domain/format.ts";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import { amountText } from "./amountText.ts";
import { type SafeSpendingActivity } from "./safeSpendingActivity.ts";
import {
	SafeSpendingSectionHeader,
	TransactionSectionView,
} from "./TransactionSectionView.tsx";

export function SafeSpendingCyclePanel({
	activity,
	summary,
	accounts,
	transactions,
	readOnly,
	transactionOrder,
	onTransactionOrderChange,
}: {
	activity: SafeSpendingActivity;
	summary: Pick<SafeSpendingSummary, "paymentPeriodStart" | "payoffDate">;
	accounts: Account[];
	transactions: Transaction[];
	readOnly: boolean;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
}) {
	const savedById = useMemo(
		() => new Map(transactions.map((saved) => [saved.id, saved])),
		[transactions],
	);
	const transferPeers = useTransferPeers(transactions, accounts);
	const visible = [...activity.spending, ...activity.cashPayments];
	const { selected, inspect, close } = useTransactionSelection(
		visible,
		savedById,
	);
	const cashSubtitle = `Recorded amounts · ${monthDay(summary.paymentPeriodStart)} – ${monthDay(summary.payoffDate)}`;
	return (
		<TransactionAnalysisProvider
			transactionIds={visible.map((row) => row.transactionId)}
		>
			<div className="grid content-start gap-4">
				<div className="grid gap-1">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted-foreground">Spent</span>
						<strong className="m-0 text-base font-bold tabular-nums text-foreground [overflow-wrap:anywhere]">
							{amountText(activity.summary.total)}
						</strong>
					</div>
					{activity.summary.byCard.map((card) => (
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
				<SafeSpendingSectionHeader title="Spending this cycle" />
				<div className="flex justify-end">
					<TransactionSortButton
						order={transactionOrder}
						onChange={onTransactionOrderChange}
					/>
				</div>
				<TransactionSectionView
					transactions={activity.spending}
					caption="Spending this cycle"
					emptyMessage="No spending this cycle yet."
					savedTransactions={savedById}
					transferPeers={transferPeers}
					onInspect={inspect}
					order={transactionOrder}
				/>
				{activity.cashPayments.length > 0 && (
					<>
						<SafeSpendingSectionHeader
							title="Cash payments this cycle"
							subtitle={cashSubtitle}
							total={activity.cashPaymentsTotal}
						/>
						<TransactionSectionView
							transactions={activity.cashPayments}
							caption="Cash payments this cycle"
							emptyMessage="No recorded cash payments in this period."
							savedTransactions={savedById}
							transferPeers={transferPeers}
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
		</TransactionAnalysisProvider>
	);
}
