import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	TriangleAlert,
} from "lucide-react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { externalCounterpartyName } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Movement } from "../../domain/model.ts";
import { Badge } from "../ui.tsx";
import { TransactionItemRow } from "./TransactionItem.tsx";

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
					<time className="transaction-mobile-date" dateTime={transaction.date}>
						{dateLabel(transaction.date, true)}
					</time>
				),
				badges: (transaction.pending ||
					transaction.excluded ||
					transaction.shortfall > 0.01) && (
					<span className="transaction-badges">
						{transaction.pending ? (
							<Badge tone="neutral">Pending</Badge>
						) : (
							transaction.excluded && (
								<Badge tone="amber">Excluded from plan</Badge>
							)
						)}
						{transaction.shortfall > 0.01 && (
							<Badge tone="amber">
								<TriangleAlert size={10} />
								{shortfallLabel ?? "Shortfall"}
							</Badge>
						)}
					</span>
				),
			}}
			amount={
				<>
					<strong className={transaction.direction === "in" ? "positive" : ""}>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.shortfall > 0.01 && (
						<small>{exactMoney(transaction.requested)} planned</small>
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
