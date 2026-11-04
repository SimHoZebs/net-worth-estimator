import type { ReactNode } from "react";
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
				<h3 className="m-0 text-xs font-semibold text-ink">{title}</h3>
				{subtitle && (
					<p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
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
	/** Transaction date whose cumulative spending crossed the threshold. */
	date: string;
	tone: "warning" | "danger";
	label: string;
}

function ThresholdDivider({
	tone,
	label,
}: Pick<SpendingLimitDivider, "tone" | "label">) {
	return (
		<tr>
			<td colSpan={3} className="border-0 p-0">
				<div
					role="separator"
					aria-label={label}
					className="flex items-center gap-3 py-1"
				>
					<span
						aria-hidden="true"
						className={
							tone === "danger"
								? "h-0.5 flex-1 rounded-control bg-danger-text"
								: "flex-1 border-t-2 [border-top-style:dashed] border-warning-text"
						}
					/>
					<span
						aria-hidden="true"
						className={
							tone === "danger"
								? "text-xs font-semibold whitespace-nowrap text-danger-text"
								: "text-xs font-semibold whitespace-nowrap text-warning-text"
						}
					>
						{label}
					</span>
				</div>
			</td>
		</tr>
	);
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
}) {
	if (!transactions.length) {
		return (
			<div className="border-t border-line pt-3">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	const dividerByDate = new Map<string, SpendingLimitDivider>();
	for (const divider of dividers) {
		const existing = dividerByDate.get(divider.date);
		if (!existing || divider.tone === "danger") {
			dividerByDate.set(divider.date, divider);
		}
	}
	// The latest transaction date has no newer row to carry its bottom
	// border. Keep that boundary as a standalone divider at the list edge.
	const latestDate = transactions.reduce(
		(latest, transaction) =>
			transaction.date > latest ? transaction.date : latest,
		transactions[0]!.date,
	);
	const edgeDivider = dividerByDate.get(latestDate) ?? null;
	const rowDividers = new Map<string, SpendingLimitDivider>();
	for (let index = 0; index < transactions.length - 1; index++) {
		const current = transactions[index]!;
		const next = transactions[index + 1]!;
		if (current.date === next.date) continue;
		const boundaryDate = current.date < next.date ? current.date : next.date;
		const divider = dividerByDate.get(boundaryDate);
		if (divider) rowDividers.set(current.id, divider);
	}
	const rows: ReactNode[] = transactions.map((transaction) => (
		<TransactionRow
			key={transaction.id}
			transaction={transaction}
			savedTransaction={
				savedTransactions.get(transaction.transactionId) ?? null
			}
			onEdit={(savedTransaction) => onInspect(transaction, savedTransaction)}
			divider={rowDividers.get(transaction.id)}
		/>
	));
	if (edgeDivider && order === "newest") {
		rows.unshift(
			<ThresholdDivider key={`divider-${edgeDivider.date}`} {...edgeDivider} />,
		);
	}
	if (edgeDivider && order === "oldest") {
		rows.push(
			<ThresholdDivider key={`divider-${edgeDivider.date}`} {...edgeDivider} />,
		);
	}
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
