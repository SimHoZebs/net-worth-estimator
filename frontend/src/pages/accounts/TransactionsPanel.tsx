import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { TransactionItemRow } from "../../components/activity/TransactionItem.tsx";
import { TransactionDetail } from "../../components/activity/TransactionDetail.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { cn } from "@/lib/utils.ts";
import {
	isPendingTransaction,
	type Account,
	type Transaction,
} from "../../domain/model.ts";

export function TransactionsPanel({
	transactions,
	accounts,
	startDate,
	readOnly,
	ruleCadence,
	showHeaders = false,
}: {
	transactions: Transaction[];
	accounts: Account[];
	startDate: string;
	readOnly: boolean;
	/** Display cadence per rule id, read from the rule rows by the caller. */
	ruleCadence?: Map<string, string>;
	showHeaders?: boolean;
}) {
	const cadenceOf = (id: string) => ruleCadence?.get(id) ?? "Recurring";
	if (!transactions.length)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ArrowRight aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No matching transactions</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId
		? (transactions.find((transaction) => transaction.id === selectedId) ??
			null)
		: null;
	const selectedClaimRuleName = selected?.claimScheduleId
		? (transactions.find(
				(transaction) => transaction.id === selected.claimScheduleId,
			)?.name ?? null)
		: null;
	return (
		<>
			<TransactionTable
				caption="Transactions with dates and amounts."
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
								badges: (transaction.void || excluded) && (
									<>
										{transaction.void ? (
											<Badge variant="secondary">Did not post</Badge>
										) : (
											excluded && (
												<Badge
													variant="default"
													className="bg-warning-bg text-warning-text"
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
									<TransactionAmount transaction={transaction} />
									{pending ? <Badge variant="secondary">Pending</Badge> : null}
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

function TransactionAmount({ transaction }: { transaction: Transaction }) {
	if (transaction.amountKnown)
		return (
			<strong className={cn("text-sm font-semibold max-sm:text-xs")}>
				{money(transaction.amount)}
			</strong>
		);
	return (
		<strong
			className={cn("text-sm font-semibold max-sm:text-xs")}
			title="Calculated during projection · varies each occurrence"
		>
			Varies
		</strong>
	);
}
