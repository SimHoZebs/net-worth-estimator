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
import type { Movement } from "../../domain/model.ts";
import { useReceiptLinks } from "../../state/receipts.ts";
import { Badge } from "../Badge.tsx";
import { TransactionItemRow } from "./TransactionItem.tsx";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
} from "./activityStyles.ts";

export function TransactionRow({
	transaction,
	movement,
	onEdit,
	shortfallLabel,
}: {
	transaction: AccountTransaction;
	movement: Movement | null;
	onEdit: (movement: Movement) => void;
	shortfallLabel?: string;
}) {
	const DirectionIcon =
		transaction.category === "transfer"
			? ArrowRightLeft
			: transaction.direction === "in"
				? ArrowDownLeft
				: ArrowUpRight;
	const tone =
		transaction.category === "transfer"
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
	const receipts = useReceiptLinks(movement?.id ?? "");
	const receiptBadge =
		movement && receipts.length > 0 ? (
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
				badges: (transaction.pending ||
					transaction.excluded ||
					transaction.shortfall > 0.01 ||
					receiptBadge) && (
					<>
						{receiptBadge}{" "}
						{transaction.pending ? (
							<Badge tone="neutral" className={transactionBadgeStyles()}>
								Pending
							</Badge>
						) : (
							transaction.excluded && (
								<Badge tone="warning" className={transactionBadgeStyles()}>
									Excluded from plan
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
						className={transactionAmountStyles({
							positive: transaction.direction === "in",
						})}
					>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.shortfall > 0.01 && (
						<small className="m-0 block text-xs text-warning-text">
							{exactMoney(transaction.requested)} planned
						</small>
					)}
				</>
			}
			actionLabel={`${action} ${transaction.name} on ${dateLabel(transaction.date, true)}${counterparty ? `; ${transaction.direction === "in" ? "money in from" : "money out to"} ${counterparty}` : ""}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${transaction.pending ? "; pending" : transaction.excluded ? "; excluded from plan" : ""}`}
			onSelect={() => {
				if (movement) onEdit(movement);
			}}
			selectDisabled={!movement}
		/>
	);
}
