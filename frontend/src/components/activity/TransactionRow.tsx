import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ReceiptText,
	TriangleAlert,
} from "lucide-react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { externalCounterpartyName } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Transaction } from "../../domain/model.ts";
import { Badge } from "../Badge.tsx";
import { TransactionItemRow } from "./TransactionItem.tsx";
import { useTransactionBNPL } from "../analysis/TransactionAnalysis.tsx";
import { findingLabel } from "../../domain/analysisFindings.ts";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
	transactionDividerLabelStyles,
} from "./activityStyles.ts";
import { mergeStyles } from "../mergeStyles.ts";

export function TransactionRow({
	transaction,
	savedTransaction,
	onEdit,
	shortfallLabel,
	divider,
	shortfall,
}: {
	transaction: AccountTransaction;
	savedTransaction: Transaction | null;
	onEdit: (savedTransaction: Transaction) => void;
	shortfallLabel?: string;
	divider?: { tone: "warning" | "danger"; label: string };
	shortfall?: boolean;
}) {
	const DirectionIcon =
		transaction.flow === "transfer"
			? ArrowRightLeft
			: transaction.direction === "in"
				? ArrowDownLeft
				: ArrowUpRight;
	const tone =
		transaction.flow === "transfer"
			? ("transfer" as const)
			: transaction.direction === "in"
				? ("inflow" as const)
				: ("outflow" as const);
	const action = "View";
	// Counterparties that only restate the direction ("External
	// income/spending" just means in/out) carry no information the icon
	// does not already show. Real accounts still show.
	const counterparty =
		transaction.counterparty === externalCounterpartyName("in") ||
		transaction.counterparty === externalCounterpartyName("out")
			? null
			: transaction.counterparty;
	const receipts = savedTransaction?.receiptIds ?? [];
	const finding = useTransactionBNPL(savedTransaction?.id ?? "");
	const analysisBadge =
		finding &&
		savedTransaction?.kind === "transaction" &&
		!transaction.pending &&
		!transaction.void ? (
			<Badge tone="neutral" className={transactionBadgeStyles()}>
				{findingLabel(finding)}
			</Badge>
		) : null;
	const receiptBadge =
		savedTransaction && receipts.length > 0 ? (
			<Badge tone="neutral" className={transactionBadgeStyles()}>
				<ReceiptText size={10} aria-hidden="true" />
				{receipts.length}
				<span className="sr-only">
					{receipts.length === 1 ? "1 receipt" : `${receipts.length} receipts`}
				</span>
			</Badge>
		) : null;
	return (
		<TransactionItemRow
			date={
				<time dateTime={transaction.date}>
					{dateLabel(transaction.date, true)}
				</time>
			}
			icon={<DirectionIcon size={16} aria-hidden="true" />}
			tone={tone}
			title={transaction.name}
			divider={divider?.tone}
			shortfall={transaction.shortfall > 0.01 && shortfall}
			slots={{
				subtitle: counterparty && (
					<span>
						{transaction.direction === "in" ? "From" : "To"} {counterparty}
					</span>
				),
				mobile: (
					<time dateTime={transaction.date}>
						{dateLabel(transaction.date, true)}
					</time>
				),
				badges: (transaction.void ||
					transaction.excluded ||
					transaction.shortfall > 0.01 ||
					receiptBadge ||
					analysisBadge) && (
					<>
						{analysisBadge}
						{receiptBadge}{" "}
						{transaction.void ? (
							<Badge tone="neutral" className={transactionBadgeStyles()}>
								Did not post
								<span className="sr-only">bank hold that did not post</span>
							</Badge>
						) : (
							transaction.excluded && (
								<Badge tone="warning" className={transactionBadgeStyles()}>
									Excluded from account
								</Badge>
							)
						)}
						{transaction.shortfall > 0.01 && (
							<Badge tone="warning" className={transactionBadgeStyles()}>
								<TriangleAlert size={10} />
								{shortfallLabel ?? "Shortfall"}
							</Badge>
						)}
					</>
				),
			}}
			amount={
				<>
					<strong
						className={mergeStyles(
							transactionAmountStyles({
								positive: transaction.direction === "in",
							}),
							transaction.shortfall > 0.01 && shortfall && "text-warning-text",
						)}
					>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.pending ? (
						<Badge tone="neutral" className={transactionBadgeStyles()}>
							Pending
						</Badge>
					) : null}
					{transaction.shortfall > 0.01 && (
						<small className="block text-xs text-warning-text">
							{exactMoney(transaction.requested)} planned
						</small>
					)}
					{divider && (
						<small
							className={transactionDividerLabelStyles({ tone: divider.tone })}
						>
							{divider.label}
						</small>
					)}
				</>
			}
			actionLabel={`${action} ${transaction.name} on ${dateLabel(transaction.date, true)}${counterparty ? `; ${transaction.direction === "in" ? "money in from" : "money out to"} ${counterparty}` : ""}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${divider ? `; ${divider.label}` : ""}${transaction.void ? "; did not post" : transaction.pending ? "; pending" : transaction.excluded ? "; excluded from account" : ""}${analysisBadge && finding ? `; ${findingLabel(finding)}` : ""}`}
			onSelect={() => {
				if (savedTransaction) onEdit(savedTransaction);
			}}
			selectDisabled={!savedTransaction}
		/>
	);
}
