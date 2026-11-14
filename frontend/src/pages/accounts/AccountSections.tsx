import { Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { balanceRowToDisplay } from "../../api/adapter.ts";
import {
	isGroupedDisplay,
	toDisplayAccounts,
	toDisplayTransaction,
} from "../../domain/accountDisplay.ts";
import {
	type Account,
	visibleAccounts,
	visibleTransactions,
} from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshAccounts,
	useAccountBalances,
	useSchedules,
	useTransactions,
} from "../../state/workspaceResources.ts";
import {
	scheduleToDisplay,
	transactionToDisplay,
} from "../../domain/transactionRows.ts";
import { frequencyLabel } from "../../domain/recurringPatterns.ts";
import { deleteAccount, deleteLoan } from "@/api/generated/endpoints.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedState.ts";
import { useRouter } from "@tanstack/react-router";
import { useWorkspaceOverlays } from "../../workspace/useWorkspaceOverlays.ts";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { TransactionsPanel } from "./TransactionsPanel.tsx";
import { cn } from "@/lib/utils.ts";

export type AccountSectionView = "accounts" | "transactions";

type TabItem<T extends string> = {
	id: T;
	label: string;
	count?: number | null;
};

type ScheduleFilter = "all" | "recurring";

const TRANSACTIONS_PAGE_SIZE = 10;

export function AccountSections({ view }: { view: AccountSectionView }) {
	const overlays = useWorkspaceOverlays();
	const router = useRouter();
	const onEdit = overlays.openEditor;
	const onAccount = (id: string) =>
		void router.navigate({
			to: "/accounts/$accountId",
			params: { accountId: id },
		});
	// Each view subscribes to its own queries; only the viewed tab renders.
	if (view === "accounts") {
		return <AccountsView onEdit={onEdit} onAccount={onAccount} />;
	}
	return <TransactionsView onEdit={onEdit} />;
}

function AccountsView({
	onEdit,
	onAccount,
}: {
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [remove, setRemove] = useState<Account | null>(null);
	const [removing, setRemoving] = useState(false);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const balances = useAccountBalances();
	const searchId = useId();
	const visible = useMemo(
		() =>
			visibleAccounts(
				toDisplayAccounts(
					(balances.data?.accounts ?? []).map(balanceRowToDisplay),
				),
			),
		[balances.data],
	);
	const accounts = visible.filter((account) =>
		account.name.toLowerCase().includes(query.toLowerCase()),
	);
	const deleteItem = async () => {
		if (!remove || removing) return;
		if (visible.length <= 1) {
			setRemoveError(
				"Keep at least one account. Add a replacement before removing this one.",
			);
			return;
		}
		setRemoving(true);
		setRemoveError(null);
		const ok = await performSave({
			call: () =>
				isGroupedDisplay(remove)
					? deleteLoan(remove.id)
					: deleteAccount(remove.id),
			refresh: refreshAccounts,
			failureMessage: "The account could not be removed.",
		});
		setRemoving(false);
		// Success closes the dialog. A failure reaches the toast from the
		// account write; the dialog stays open with the validation slot for
		// retry. The only inline error here is the single-account guard below.
		if (ok) setRemove(null);
	};
	return (
		<>
			<section>
				<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4">
					<Label
						htmlFor={searchId}
						className="inline-flex items-center gap-2 text-subtle"
					>
						<Search size={16} aria-hidden="true" />
						<span className="sr-only">Search accounts</span>
						<Input
							id={searchId}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Find an account…"
							className={cn(
								"h-11 w-32 rounded-none border-0 bg-transparent px-1 py-2 text-sm font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60 sm:w-48 focus-visible:outline-solid focus-visible:ring-0",
								"disabled:bg-transparent",
							)}
						/>
					</Label>
					<Button
						type="button"
						variant="default"
						size="sm"
						className="max-sm:px-3 max-sm:py-2"
						onClick={() => onEdit({ kind: "account", item: null })}
					>
						<Plus size={16} />
						Add account
					</Button>
				</div>
				{balances.isPending ? (
					<p role="status">Loading accounts…</p>
				) : balances.isError ? (
					<p role="alert">
						Accounts could not be loaded.{" "}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => void balances.refetch()}
						>
							Retry
						</Button>
					</p>
				) : (
					<AccountsPanel
						accounts={accounts}
						onAccount={onAccount}
						onEdit={(item) => onEdit({ kind: "account", item })}
						onRemove={setRemove}
					/>
				)}
			</section>
			{remove && (
				<AlertDialog
					open={true}
					onOpenChange={(next) => {
						if (!next && !removing) {
							setRemove(null);
							setRemoveError(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<p className="text-xs font-bold tracking-widest text-muted">
								Changes
							</p>
							<AlertDialogTitle>Remove {remove.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								This deletes the account immediately. Balance history for this
								account goes with it.
							</AlertDialogDescription>
						</AlertDialogHeader>
						{removeError && (
							<Alert variant="destructive">
								<AlertDescription>{removeError}</AlertDescription>
							</Alert>
						)}
						<AlertDialogFooter>
							<AlertDialogCancel
								variant="secondary"
								disabled={removing}
								onClick={() => {
									setRemove(null);
									setRemoveError(null);
								}}
							>
								Keep account
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={removing}
								onClick={() => void deleteItem()}
							>
								{removing ? "Removing…" : "Remove account"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</>
	);
}

function TransactionsView({
	onEdit,
}: {
	onEdit: (target: EditorTarget) => void;
}) {
	const accounts = useSavedAccounts();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	const [query, setQuery] = useState("");
	const [schedule, setSchedule] = useState<ScheduleFilter>("all");
	const [order, setOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	const [page, setPage] = useState(0);
	const listId = useId();
	const transactionsQuery = useTransactions();
	const rulesQuery = useSchedules();
	// Finance-first: rows render from saved query rows alone. Literal
	// amounts show directly; formula-derived amounts stay Varies without
	// a forecast request. Memos stay mounted while rows load, so inputs
	// are null-safe; the saved rows gate only the list.
	const rows = useMemo(
		() =>
			(transactionsQuery.data?.transactions ?? []).map((row) =>
				toDisplayTransaction(transactionToDisplay(row), accounts ?? []),
			),
		[transactionsQuery.data, accounts],
	);
	// Rules are their own rows from their own endpoint. The table renders
	// them through the same display shape the shared editor uses.
	const rules = useMemo(
		() => rulesQuery.data?.schedules ?? [],
		[rulesQuery.data],
	);
	const ruleRows = useMemo(
		() =>
			rules.map((rule) =>
				toDisplayTransaction(scheduleToDisplay(rule), accounts ?? []),
			),
		[rules, accounts],
	);
	const ruleCadence = useMemo(
		() =>
			new Map(rules.map((rule) => [rule.id, frequencyLabel(rule.frequency)])),
		[rules],
	);
	const visible = useMemo(
		() =>
			visibleTransactions({
				transactions: [...rows, ...ruleRows],
				accounts: accounts ?? [],
			}),
		[rows, ruleRows, accounts],
	);
	const recurringCount = visible.filter(
		(transaction) => transaction.kind === "schedule",
	).length;
	const transactionsCount = visible.filter(
		(transaction) => transaction.kind === "transaction",
	).length;
	// Saved accounts hydrate after the controls. Hide counts until then
	// instead of showing false zeros.
	const savedRowsPending = !accounts || !startDate;
	const tabs: TabItem<ScheduleFilter>[] = [
		{
			id: "all",
			label: "Transactions",
			count: savedRowsPending ? null : transactionsCount,
		},
		{
			id: "recurring",
			label: "Recurring",
			count: savedRowsPending ? null : recurringCount,
		},
	];
	const sortedTransactions = useMemo(
		() =>
			sortTransactionsByDate({
				items: visible.filter(
					(transaction) =>
						transaction.name.toLowerCase().includes(query.toLowerCase()) &&
						(schedule === "all"
							? transaction.kind === "transaction"
							: transaction.kind === "schedule"),
				),
				getDate: (transaction) => transaction.startDate,
				getId: (transaction) => transaction.id,
				order,
			}),
		[visible, query, schedule, order],
	);
	const pageCount = Math.max(
		1,
		Math.ceil(sortedTransactions.length / TRANSACTIONS_PAGE_SIZE),
	);
	const currentPage = Math.min(page, pageCount - 1);
	const pagedTransactions = sortedTransactions.slice(
		currentPage * TRANSACTIONS_PAGE_SIZE,
		(currentPage + 1) * TRANSACTIONS_PAGE_SIZE,
	);
	const resetFilters = (next: ScheduleFilter) => {
		setSchedule(next);
		setQuery("");
		setPage(0);
	};
	const search = (value: string) => {
		setQuery(value);
		setPage(0);
	};
	const changeOrder = (next: TransactionOrder) => {
		setOrder(next);
		setPage(0);
	};
	const turnPage = (next: number) => {
		setPage(next);
		document.getElementById(listId)?.scrollIntoView({ block: "nearest" });
	};
	return (
		<Tabs
			value={schedule}
			onValueChange={(next) => {
				if (next) resetFilters(next as ScheduleFilter);
			}}
			className="gap-0"
		>
			<TabsList
				variant="line"
				aria-label="Transactions sections"
				className={cn(
					"mb-6 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0 max-sm:gap-5",
				)}
			>
				{tabs.map((item) => (
					<TabsTrigger
						key={item.id}
						value={item.id}
						className={cn(
							"flex flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
							"h-auto focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
						)}
					>
						{item.label}
						{item.count != null && (
							<span className="min-w-5 rounded-control bg-active px-1 py-px text-xs text-success-text">
								{item.count}
							</span>
						)}
					</TabsTrigger>
				))}
			</TabsList>
			<TabsContent value={schedule}>
				<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4 max-sm:pb-4">
					<Label
						htmlFor={`${listId}-search`}
						className="inline-flex items-center gap-2 text-subtle"
					>
						<Search size={16} aria-hidden="true" />
						<span className="sr-only">Search transactions</span>
						<Input
							id={`${listId}-search`}
							value={query}
							onChange={(event) => search(event.target.value)}
							placeholder="Find a transaction…"
							className={cn(
								"h-11 w-32 rounded-none border-0 bg-transparent px-1 py-2 text-sm font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60 sm:w-48 focus-visible:outline-solid focus-visible:ring-0",
								"disabled:bg-transparent",
							)}
						/>
					</Label>
					<div className="flex shrink-0 flex-wrap items-center gap-3">
						<TransactionSortButton order={order} onChange={changeOrder} />
						{schedule === "recurring" ? (
							<Button
								type="button"
								variant="default"
								size="sm"
								onClick={() => onEdit({ kind: "schedule", item: null })}
							>
								<Plus size={16} />
								Add schedule
							</Button>
						) : (
							<Button
								type="button"
								variant="default"
								size="sm"
								onClick={() => onEdit({ kind: "transaction", item: null })}
							>
								<Plus size={16} />
								Add transaction
							</Button>
						)}
					</div>
				</div>
				<div id={listId}>
					{savedRowsPending ||
					transactionsQuery.isPending ||
					rulesQuery.isPending ? (
						<p role="status">Loading transactions…</p>
					) : transactionsQuery.isError || rulesQuery.isError ? (
						<p role="alert">
							Transactions could not be loaded.{" "}
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => {
									void transactionsQuery.refetch();
									void rulesQuery.refetch();
								}}
							>
								Retry
							</Button>
						</p>
					) : (
						<TransactionsPanel
							transactions={pagedTransactions}
							accounts={visibleAccounts(accounts ?? [])}
							startDate={startDate ?? ""}
							readOnly={readOnly}
							ruleCadence={ruleCadence}
						/>
					)}
				</div>
				{pageCount > 1 && (
					<div
						className={cn(
							"flex items-center justify-between gap-4 border-b border-line py-4 max-sm:gap-2",
							"border-t",
							"px-0.5",
						)}
					>
						<span className="text-xs text-muted" role="status">
							Showing {currentPage * TRANSACTIONS_PAGE_SIZE + 1}–
							{Math.min(
								(currentPage + 1) * TRANSACTIONS_PAGE_SIZE,
								sortedTransactions.length,
							)}{" "}
							of {sortedTransactions.length} transactions
						</span>
						<Pagination className="mx-0 w-auto justify-end">
							<PaginationContent>
								<PaginationItem>
									<PaginationPrevious
										aria-label="Previous transaction page"
										aria-disabled={currentPage === 0}
										className={cn(
											currentPage === 0 && "pointer-events-none opacity-50",
										)}
										onClick={() => turnPage(Math.max(currentPage - 1, 0))}
									/>
								</PaginationItem>
								<span className="text-xs text-muted tabular-nums">
									{currentPage + 1} / {pageCount}
								</span>
								<PaginationItem>
									<PaginationNext
										aria-label="Next transaction page"
										aria-disabled={currentPage >= pageCount - 1}
										className={cn(
											currentPage >= pageCount - 1 &&
												"pointer-events-none opacity-50",
										)}
										onClick={() =>
											turnPage(Math.min(currentPage + 1, pageCount - 1))
										}
									/>
								</PaginationItem>
							</PaginationContent>
						</Pagination>
					</div>
				)}
			</TabsContent>
		</Tabs>
	);
}
