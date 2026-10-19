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
	const action = movement?.readOnly ? "Inspect" : "Edit";
	// Counterparties that only restate the direction ("External
	// income/spending" just means in/out) carry no information the icon
	// does not already show. Real accounts still show.
	const counterparty =
		transaction.counterparty === externalCounterpartyName("in") ||
		transaction.counterparty === externalCounterpartyName("out")
			? null
			: transaction.counterparty;
	return (
		<tr className="transaction-row">
			<td className="transaction-date-column">
				<time dateTime={transaction.date}>
					{dateLabel(transaction.date, true)}
				</time>
			</td>
			<th scope="row">
				<button
					type="button"
					className="transaction-row-button"
					aria-label={`${action} ${transaction.name} on ${dateLabel(transaction.date, true)}${counterparty ? `; ${transaction.direction === "in" ? "money in from" : "money out to"} ${counterparty}` : ""}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${transaction.pending ? "; pending" : transaction.excluded ? "; excluded from plan" : ""}`}
					onClick={() => {
						if (movement) onEdit(movement);
					}}
					disabled={!movement}
				>
					<span
						className={`movement-icon ${transaction.category === "transfer" ? "transfer" : transaction.direction === "in" ? "inflow" : "outflow"}`}
					>
						<DirectionIcon size={16} aria-hidden="true" />
					</span>
					<span className="transaction-name">
						<strong>{transaction.name}</strong>
						{counterparty && (
							<span>
								{transaction.direction === "in" ? "From" : "To"} {counterparty}
							</span>
						)}
						<time
							className="transaction-mobile-date"
							dateTime={transaction.date}
						>
							{dateLabel(transaction.date, true)}
						</time>
						{(transaction.pending ||
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
						)}
					</span>
				</button>
			</th>
			<td className="transaction-amount-column">
				<span className="transaction-amount">
					<strong className={transaction.direction === "in" ? "positive" : ""}>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.shortfall > 0.01 && (
						<small>{exactMoney(transaction.requested)} planned</small>
					)}
				</span>
			</td>
		</tr>
	);
}
