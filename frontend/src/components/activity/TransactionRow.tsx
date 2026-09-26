import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ChevronDown,
	TriangleAlert,
} from "lucide-react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Movement } from "../../domain/model.ts";
import { Badge } from "../ui.tsx";
import { TransactionDetails } from "./TransactionDetails.tsx";

export function TransactionRow({
	transaction,
	movement,
	open,
	detailId,
	onToggle,
	onEdit,
}: {
	transaction: AccountTransaction;
	movement: Movement | null;
	open: boolean;
	detailId: string;
	onToggle: () => void;
	onEdit: (movement: Movement) => void;
}) {
	const DirectionIcon =
		transaction.category === "transfer"
			? ArrowRightLeft
			: transaction.direction === "in"
				? ArrowDownLeft
				: ArrowUpRight;
	return (
		<>
			<tr
				className={
					open ? "transaction-row transaction-row-open" : "transaction-row"
				}
			>
				<td className="transaction-date-column">
					<time dateTime={transaction.date}>
						{dateLabel(transaction.date, true)}
					</time>
				</td>
				<th scope="row">
					<button
						type="button"
						className="transaction-row-button"
						aria-label={`Inspect ${transaction.name} on ${dateLabel(transaction.date, true)}; ${transaction.source}; ${transaction.direction === "in" ? "money in from" : "money out to"} ${transaction.counterparty}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${transaction.excluded ? "; excluded from plan" : ""}`}
						aria-expanded={open}
						aria-controls={open ? detailId : undefined}
						onClick={onToggle}
					>
						<span
							className={`movement-icon ${transaction.category === "transfer" ? "transfer" : transaction.direction === "in" ? "inflow" : "outflow"}`}
						>
							<DirectionIcon size={16} aria-hidden="true" />
						</span>
						<span className="transaction-name">
							<strong>{transaction.name}</strong>
							<span>
								{transaction.direction === "in" ? "From" : "To"}{" "}
								{transaction.counterparty}
							</span>
							<time
								className="transaction-mobile-date"
								dateTime={transaction.date}
							>
								{dateLabel(transaction.date, true)}
							</time>
							<span className="transaction-badges">
								<Badge
									tone={transaction.source === "recorded" ? "green" : "outline"}
								>
									{transaction.source === "recorded" ? "Recorded" : "Projected"}
								</Badge>
								{transaction.excluded && (
									<Badge tone="amber">Excluded from plan</Badge>
								)}
								{transaction.shortfall > 0.01 && (
									<Badge tone="amber">
										<TriangleAlert size={10} />
										Shortfall
									</Badge>
								)}
							</span>
						</span>
						<ChevronDown
							size={14}
							className="transaction-chevron"
							aria-hidden="true"
						/>
					</button>
				</th>
				<td className="transaction-amount-column">
					<strong className={transaction.direction === "in" ? "positive" : ""}>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.shortfall > 0.01 && (
						<small>{exactMoney(transaction.requested)} planned</small>
					)}
				</td>
			</tr>
			{open && (
				<tr className="transaction-detail-row">
					<td colSpan={3}>
						<div id={detailId}>
							<TransactionDetails
								transaction={transaction}
								movement={movement}
								onEdit={onEdit}
							/>
						</div>
					</td>
				</tr>
			)}
		</>
	);
}
