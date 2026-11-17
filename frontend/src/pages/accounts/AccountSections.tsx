import { Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";
import { TablePagination } from "../../components/TablePagination.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { FieldLabel } from "@/components/ui/field.tsx";
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
	toDisplayAccounts,
	toDisplayTransaction,
} from "../../domain/accountDisplay.ts";
import { visibleAccounts, visibleTransactions } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import {
	useAccountBalances,
	useSchedules,
	useTransactions,
} from "../../state/workspaceResources.ts";
import {
	scheduleToDisplay,
	transactionToDisplay,
} from "../../domain/transactionRows.ts";
import { frequencyLabel } from "../../domain/recurringPatterns.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedState.ts";
import { useRouter } from "@tanstack/react-router";
import { useWorkspaceOverlays } from "../../workspace/useWorkspaceOverlays.ts";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { TransactionsPanel } from "./TransactionsPanel.tsx";

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
	return (
		<section>
			<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4">
				<FieldLabel
					htmlFor={searchId}
					className="inline-flex w-full items-center gap-2 text-muted-foreground sm:w-auto"
				>
					<Search size={16} aria-hidden="true" className="shrink-0" />
					<span className="sr-only">Search accounts</span>
					<Input
						id={searchId}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Find an account…"
						className="w-full sm:w-48"
					/>
				</FieldLabel>
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
				<AccountsPanel accounts={accounts} onAccount={onAccount} />
			)}
		</section>
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
				scrollable
				aria-label="Transactions sections"
				className="mb-6 gap-6 max-sm:gap-5"
			>
				{tabs.map((item) => (
					<TabsTrigger key={item.id} value={item.id} className="flex-none">
						{item.label}
						{item.count != null && (
							<Badge variant="secondary">{item.count}</Badge>
						)}
					</TabsTrigger>
				))}
			</TabsList>
			<TabsContent value={schedule}>
				<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4 max-sm:pb-4">
					<FieldLabel
						htmlFor={`${listId}-search`}
						className="inline-flex w-full items-center gap-2 text-muted-foreground sm:w-auto"
					>
						<Search size={16} aria-hidden="true" className="shrink-0" />
						<span className="sr-only">Search transactions</span>
						<Input
							id={`${listId}-search`}
							value={query}
							onChange={(event) => search(event.target.value)}
							placeholder="Find a transaction…"
							className="w-full sm:w-48"
						/>
					</FieldLabel>
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
					<TablePagination
						page={currentPage}
						pageCount={pageCount}
						total={sortedTransactions.length}
						pageSize={TRANSACTIONS_PAGE_SIZE}
						topBorder
						className="px-0.5"
						onPage={setPage}
					/>
				)}
			</TabsContent>
		</Tabs>
	);
}
