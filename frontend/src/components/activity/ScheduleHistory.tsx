import { History } from "lucide-react";
import type { Transaction } from "../../domain/model.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import { Badge } from "../Badge.tsx";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
} from "./activityStyles.ts";

/**
 * Postings that record an occurrence of one schedule, newest first. The
 * claim is the association, so this reads saved postings rather than the
 * projected occurrence list. Selecting a row opens the posting detail.
 */
export function ScheduleHistory({
	transactions,
	onSelect,
}: {
	transactions: Transaction[];
	onSelect: (transaction: Transaction) => void;
}) {
	return (
		<section
			className="mt-4 border-t border-line pt-4"
			aria-label="Recorded transactions"
		>
			<div className="flex items-center gap-2">
				<History size={17} aria-hidden="true" />
				<h3 className="text-sm font-semibold">Recorded transactions</h3>
				{transactions.length > 0 && (
					<Badge tone="neutral">{transactions.length}</Badge>
				)}
			</div>
			{transactions.length === 0 ? (
				<p className="mt-2 text-sm leading-relaxed text-muted">
					No transactions record an occurrence of this schedule yet.
				</p>
			) : (
				<ul className="mt-3 flex list-none flex-col border-t border-line p-0">
					{transactions.map((transaction) => (
						<li
							key={transaction.id}
							className="border-b border-line last:border-b-0"
						>
							<ScheduleHistoryRow
								transaction={transaction}
								onSelect={onSelect}
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ScheduleHistoryRow({
	transaction,
	onSelect,
}: {
	transaction: Transaction;
	onSelect: (transaction: Transaction) => void;
}) {
	const occurrenceDate =
		transaction.claimOccurrenceDate ?? transaction.startDate;
	const direction =
		transaction.fromId && transaction.toId
			? "transfer"
			: transaction.fromId
				? "out"
				: "in";
	const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
	return (
		<button
			type="button"
			className="flex w-full flex-wrap items-center gap-3 rounded-control border-0 bg-transparent px-2 py-3 text-left hover:bg-surface-2"
			aria-label={`View ${transaction.name} recorded for ${dateLabel(occurrenceDate, true)}`}
			onClick={() => onSelect(transaction)}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<strong className="text-sm font-semibold [overflow-wrap:anywhere]">
					{transaction.name}
				</strong>
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
					<span>
						Occurrence{" "}
						<time dateTime={occurrenceDate}>
							{dateLabel(occurrenceDate, true)}
						</time>
					</span>
					{transaction.postedDate && (
						<>
							<span aria-hidden="true">·</span>
							<span>
								Posted{" "}
								<time dateTime={transaction.postedDate}>
									{dateLabel(transaction.postedDate, true)}
								</time>
							</span>
						</>
					)}
				</span>
				{(transaction.pending || transaction.void || !transaction.enabled) && (
					<span className="flex flex-wrap gap-1">
						{transaction.void ? (
							<Badge tone="neutral" className={transactionBadgeStyles()}>
								Did not post
							</Badge>
						) : (
							transaction.pending && (
								<Badge tone="warning" className={transactionBadgeStyles()}>
									Pending
								</Badge>
							)
						)}
						{!transaction.enabled &&
							!transaction.pending &&
							!transaction.void && (
								<Badge tone="warning" className={transactionBadgeStyles()}>
									Excluded
								</Badge>
							)}
					</span>
				)}
			</span>
			<strong
				className={transactionAmountStyles({
					positive: direction === "in",
				})}
			>
				{sign}
				{exactMoney(transaction.amount)}
			</strong>
		</button>
	);
}
