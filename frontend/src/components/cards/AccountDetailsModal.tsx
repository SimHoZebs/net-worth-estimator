import { Repeat2, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { accountTransactions } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";
import { AccountIcon } from "../AccountIcon.tsx";
import { Input } from "@/components/ui/input.tsx";
import { TransactionDetail } from "../activity/TransactionDetail.tsx";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { TablePagination } from "../DataTable.tsx";
import { EmptyState } from "../EmptyState.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Progress } from "../Progress.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item.tsx";
import { cn } from "@/lib/utils.ts";
import type { AccountCardModel } from "../../domain/accountCards.ts";
import { transactionSelectionKey, useSelectedId } from "../entrySelection.ts";

type StatusFilter = "all" | "pending" | "posted";

/** Rows per transaction page. */
const PAGE_SIZE = 20;

/**
 * Account detail dialog in the host Modal. Reuses TransactionRow and
 * TransactionDetail instead of a second transaction modal. Credit
 * utilization uses the shared Progress bar; role badges use Badge.
 */
export function AccountDetailsModal({
	card,
	accounts,
	transactions,
	startDate,
	readOnly,
	projection,
	onClose,
}: {
	card: AccountCardModel;
	accounts: Account[];
	/** Saved rules, for the detail view's lookups and the activity ledger. */
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	projection: Projection | null;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<StatusFilter>("all");
	const [page, setPage] = useState(0);
	const listId = useId();
	const [pageAccountId, setPageAccountId] = useState(card.id);
	if (pageAccountId !== card.id) {
		setPageAccountId(card.id);
		setPage(0);
	}
	const ledger = useMemo(
		() =>
			accountTransactions({
				accountId: card.id,
				accounts,
				transactions,
				startDate,
				projection,
			}),
		[card.id, accounts, transactions, startDate, projection],
	);
	const [selectedId, setSelectedId] = useSelectedId();
	const searchId = useId();
	const savedById = useMemo(
		() => new Map(transactions.map((saved) => [saved.id, saved])),
		[transactions],
	);
	const shown = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return ledger.filter((transaction) => {
			if (filter === "pending" && !transaction.pending) return false;
			if (
				filter === "posted" &&
				(transaction.pending || transaction.source !== "historical")
			) {
				// Posted in this dialog means recorded facts; projected
				// occurrences stay visible under All.
				if (transaction.source !== "historical") return false;
			}
			if (!needle) return true;
			return `${transaction.name} ${transaction.counterparty} ${transaction.flow} ${transaction.date}`
				.toLowerCase()
				.includes(needle);
		});
	}, [ledger, query, filter]);
	const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const rows = shown.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);
	const turnPage = (next: number) => {
		setPage(next);
		document
			.getElementById(`${listId}-table`)
			?.scrollIntoView({ block: "nearest" });
	};
	const selected = selectedId
		? (ledger.find(
				(transaction) => transactionSelectionKey(transaction) === selectedId,
			) ?? null)
		: null;
	const selectedSavedTransaction = selected
		? (savedById.get(selected.transactionId) ?? null)
		: null;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted">
						{`Account details · ${card.institution}`}
					</p>
					<DialogTitle>{card.name}</DialogTitle>
				</DialogHeader>
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<AccountIcon account={card.account} />
						<div>
							<strong className="type-value text-xl">
								{exactMoney(card.balance)}
							</strong>
							<div className="text-sm leading-relaxed text-muted">
								{card.balanceLabel}
							</div>
						</div>
					</div>
					<span className="flex flex-wrap gap-2">
						{card.roles.map((role) => (
							<Badge
								key={role}
								variant="secondary"
								className="h-auto bg-surface-3 text-muted"
							>
								{role}
							</Badge>
						))}
					</span>
				</div>
				{card.creditUtilization !== undefined && (
					<div className="mt-4">
						<div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
							<span>Credit utilization</span>
							<strong>{card.creditUtilization.toFixed(1)}%</strong>
						</div>
						<Progress
							value={card.creditUtilization}
							label="Credit utilization"
							tone={card.creditUtilization > 80 ? "warning" : "success"}
						/>
						<p className="py-2 text-sm leading-relaxed text-muted">
							Based on posted balance against the limit. Pending charges
							excluded.
						</p>
					</div>
				)}
				<ItemGroup className="my-5 gap-0">
					{card.metrics.map((metric) => (
						<Item
							key={metric.label}
							className="justify-between gap-5 rounded-none border-x-0 border-t-0 border-b border-line px-0 py-3"
						>
							<span className="text-muted">{metric.label}</span>
							<ItemContent className="flex-none flex-row items-center justify-end gap-2 text-right">
								{metric.value}
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
				<div className="mt-2 flex items-center justify-between gap-4">
					<h2 className="text-sm">Transactions</h2>
					<span className="text-sm leading-relaxed text-muted">
						{ledger.length} loaded
					</span>
				</div>
				<div className="mb-3 flex flex-wrap items-center gap-3">
					<label
						htmlFor={searchId}
						className="inline-flex flex-1 items-center gap-2 text-subtle"
					>
						<Search size={16} aria-hidden="true" />
						<span className="sr-only">Search account transactions</span>
						<Input
							id={searchId}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setPage(0);
							}}
							placeholder="Search transactions…"
							className={cn(
								"h-11 w-32 rounded-none border-0 bg-transparent px-1 py-2 text-sm text-ink placeholder:text-subtle sm:w-48",
								"disabled:bg-transparent",
								"focus-visible:outline-solid focus-visible:ring-0",
							)}
						/>
					</label>
					<ToggleGroup
						aria-label="Filter by transaction status"
						value={[filter]}
						onValueChange={(next) => {
							const nextValue = next.find((candidate) => candidate !== filter);
							if (nextValue !== undefined) {
								setFilter(nextValue as StatusFilter);
								setPage(0);
							}
						}}
						className="inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
					>
						<ToggleGroupItem
							type="button"
							value="all"
							aria-label="all"
							className="h-auto rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
						>
							All
						</ToggleGroupItem>
						<ToggleGroupItem
							type="button"
							value="pending"
							aria-label="pending"
							className="h-auto rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
						>
							Pending
						</ToggleGroupItem>
						<ToggleGroupItem
							type="button"
							value="posted"
							aria-label="posted"
							className="h-auto rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
						>
							Posted
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				{shown.length ? (
					<>
						<TransactionTable
							caption={`${card.name} transactions filtered by ${filter}.`}
							scrollId={`${listId}-table`}
						>
							{rows.map((transaction) => (
								<TransactionRow
									key={transaction.id}
									transaction={transaction}
									savedTransaction={
										savedById.get(transaction.transactionId) ?? null
									}
									onEdit={() =>
										setSelectedId(transactionSelectionKey(transaction))
									}
								/>
							))}
						</TransactionTable>
						{pageCount > 1 && (
							<TablePagination
								page={currentPage}
								pageCount={pageCount}
								total={shown.length}
								pageSize={PAGE_SIZE}
								onPage={turnPage}
							/>
						)}
					</>
				) : (
					<EmptyState
						icon={Search}
						title="No matching transactions"
						description="Try a different search or status filter."
					/>
				)}
				<p className="py-2 text-sm leading-relaxed text-muted">
					{ledger.length > 0 && selected == null ? (
						<span>
							<Repeat2 size={12} aria-hidden="true" className="align-middle" />{" "}
							Recurring transactions show in the account with their schedule.
							Dates shown {dateLabel(startDate, true)} onward.
						</span>
					) : (
						<span>
							Sample balances are never shown; every figure comes from your
							saved data.
						</span>
					)}
				</p>
				{selected && selectedSavedTransaction && (
					<TransactionDetail
						transaction={selected}
						savedTransaction={selectedSavedTransaction}
						accounts={accounts}
						transactions={transactions}
						readOnly={readOnly}
						onClose={() => setSelectedId(null)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
