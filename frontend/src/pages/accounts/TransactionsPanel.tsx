import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { TransactionItemRow } from "../../components/activity/TransactionItem.tsx";
import { TransactionDetail } from "../../components/activity/TransactionDetail.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
} from "../../components/activity/activityStyles.ts";
import { dateLabel, money } from "../../domain/format.ts";
import {
	isPendingTransaction,
	type Account,
	type Transaction,
} from "../../domain/model.ts";
import type { ResolvedTransactionAmount } from "../../domain/resolvedTransactionAmounts.ts";

export function TransactionsPanel({
	transactions,
	accounts,
	startDate,
	readOnly,
	resolvedAmounts,
	ruleCadence,
	showHeaders = false,
}: {
	transactions: Transaction[];
	accounts: Account[];
	startDate: string;
	readOnly: boolean;
	resolvedAmounts?: Map<string, ResolvedTransactionAmount>;
	/** Display cadence per rule id, read from the rule rows by the caller. */
	ruleCadence?: Map<string, string>;
	showHeaders?: boolean;
}) {
	const cadenceOf = (id: string) => ruleCadence?.get(id) ?? "Recurring";
	if (!transactions.length)
		return <EmptyState icon={ArrowRight} title="No matching transactions" />;
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId
		? (transactions.find((transaction) => transaction.id === selectedId) ??
			null)
		: null;
	const selectedResolved = selected
		? resolvedAmounts?.get(selected.id)
		: undefined;
	const selectedClaimRuleName = selected?.claimScheduleId
		? (transactions.find(
				(transaction) => transaction.id === selected.claimScheduleId,
			)?.name ?? null)
		: null;
	return (
		<>
			<TransactionTable
				caption="Planned transactions with dates and amounts."
				showHeaders={showHeaders}
			>
				{transactions.map((transaction) => {
					const pending = isPendingTransaction(transaction);
					// Bank lifecycle states are evidence, never exclusions: a
					// settled sync row counts as excluded only when the owner
					// disables it.
					const excluded =
						!transaction.enabled &&
						(transaction.syncOwned !== true ||
							(!pending && transaction.void !== true));
					// External endpoints only restate the direction, so the route
					// names real accounts only. The date lives in its own column.
					const route = [transaction.fromId, transaction.toId]
						.map((id) => (id ? names.get(id) : null))
						.filter((name): name is string => Boolean(name))
						.join(" → ");
					const tone = transaction.fromId
						? transaction.toId
							? ("transfer" as const)
							: ("outflow" as const)
						: ("inflow" as const);
					const dateText =
						transaction.kind === "transaction"
							? dateLabel(transaction.startDate, true)
							: cadenceOf(transaction.id);
					return (
						<TransactionItemRow
							key={transaction.id}
							dimmed={!transaction.enabled && !pending}
							date={
								transaction.kind === "transaction" ? (
									<time dateTime={transaction.startDate}>{dateText}</time>
								) : (
									dateText
								)
							}
							icon={
								transaction.fromId ? (
									transaction.toId ? (
										<ArrowRight size={16} aria-hidden="true" />
									) : (
										<ArrowUpRight size={16} aria-hidden="true" />
									)
								) : (
									<ArrowDownLeft size={16} aria-hidden="true" />
								)
							}
							tone={tone}
							title={transaction.name}
							slots={{
								subtitle: route ? <span>{route}</span> : undefined,
								mobile: <span>{dateText}</span>,
								badges: (pending || transaction.void || excluded) && (
									<>
										{transaction.void ? (
											<Badge
												tone="neutral"
												className={transactionBadgeStyles()}
											>
												Did not post
											</Badge>
										) : pending ? (
											<Badge
												tone="neutral"
												className={transactionBadgeStyles()}
											>
												Pending
											</Badge>
										) : (
											excluded && (
												<Badge
													tone="warning"
													className={transactionBadgeStyles()}
												>
													Excluded
												</Badge>
											)
										)}
									</>
								),
							}}
							amount={
								<>
									<TransactionAmount
										transaction={transaction}
										resolved={resolvedAmounts?.get(transaction.id)}
									/>
									{transaction.claimScheduleId &&
										transaction.claimOccurrenceDate && (
											<Badge tone="neutral">
												Records{" "}
												{dateLabel(transaction.claimOccurrenceDate, true)}
											</Badge>
										)}
								</>
							}
							actionLabel={`View ${transaction.name} on ${dateText}`}
							onSelect={() => setSelectedId(transaction.id)}
						/>
					);
				})}
			</TransactionTable>
			{selected && (
				<TransactionDetail
					transaction={scheduleTransaction({
						transaction: selected,
						accounts,
						startDate,
						resolved: selectedResolved,
					})}
					savedTransaction={selected}
					accounts={accounts}
					transactions={transactions}
					readOnly={readOnly}
					claimScheduleName={selectedClaimRuleName}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}

function TransactionAmount({
	transaction,
	resolved,
}: {
	transaction: Transaction;
	resolved: ResolvedTransactionAmount | undefined;
}) {
	if (transaction.amountKnown)
		return (
			<strong className={transactionAmountStyles()}>
				{money(transaction.amount)}
			</strong>
		);
	if (resolved) {
		const label =
			transaction.kind === "transaction"
				? `Calculated for ${dateLabel(resolved.date, true)}`
				: `Next calculated amount ${dateLabel(resolved.date, true)} · varies each occurrence`;
		return (
			<>
				<strong className={transactionAmountStyles()} title={label}>
					{money(resolved.amount)}
				</strong>
				<Badge tone="neutral">Varies</Badge>
			</>
		);
	}
	return (
		<strong
			className={transactionAmountStyles()}
			title="Calculated during projection · varies each occurrence"
		>
			Varies
		</strong>
	);
}
