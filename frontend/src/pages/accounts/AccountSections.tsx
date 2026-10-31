import { Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { TablePagination } from "../../components/DataTable.tsx";
import { Button } from "../../components/Button.tsx";
import { SearchField } from "../../components/Field.tsx";
import { type TabItem, Tabs } from "../../components/Tabs.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "../../api/contracts.ts";
import {
	type Account,
	visibleAccounts,
	visibleTransactions,
} from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshAccounts,
	useAccountBalances,
	useTransactions,
} from "../../state/workspaceResources.ts";
import { transactionToDisplay } from "../../domain/transactionRows.ts";
import { deleteAccount } from "@/api/generated/endpoints.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedRows.ts";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { TransactionsPanel } from "./TransactionsPanel.tsx";

export type AccountSectionView = "accounts" | "transactions";

type ScheduleFilter = "all" | "recurring";

const TRANSACTIONS_PAGE_SIZE = 10;

export function AccountSections({
	view,
	onEdit,
	onAccount,
}: {
	view: AccountSectionView;
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	// Each view subscribes to its own queries; only the viewed tab and UI
	// callbacks arrive as props.
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
	const visible = useMemo(
		() =>
			visibleAccounts(
				(balances.data?.accounts ?? []).map((row): Account => ({
					id: row.id,
					name: row.name,
					kind:
						parseUnion(row.kind, [
							"cash",
							"investment",
							"debt",
							"property",
						] as const) ?? "cash",
					enabled: row.enabled,
					archived: row.archived,
					balance: row.balance,
					minBalance:
						row.minBalance === null ||
						row.minBalance === NO_FLOOR_SENTINEL ||
						row.minBalance < 0
							? 0
							: row.minBalance,
					maxBalance:
						row.maxBalance === null ||
						row.maxBalance === NO_CEILING_SENTINEL ||
						row.maxBalance < 0
							? null
							: row.maxBalance,
					color: row.color ?? null,
					observedOn: row.observedOn,
					balanceCheck: row.hasCheckpoint,
					source: row.syncOwned ? "Synced account" : "Manual entry",
					readOnly: row.readOnly,
					observedBalance: row.observedBalance ?? null,
					observedAt: row.observedAt ?? null,
				})),
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
			call: () => deleteAccount(remove.id),
			refresh: refreshAccounts,
			failureMessage: "The account could not be removed.",
		});
		setRemoving(false);
		if (ok) setRemove(null);
		else setRemoveError("The account could not be removed.");
	};
	return (
		<>
			<section>
				<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4">
					<SearchField
						label="Search accounts"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Find an account…"
					/>
					<Button
						type="button"
						variant="primary"
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
				<ConfirmDialog
					title={`Remove ${remove.name}?`}
					eyebrow="Changes"
					onCancel={() => {
						setRemove(null);
						setRemoveError(null);
					}}
					onConfirm={() => void deleteItem()}
					cancelLabel="Keep account"
					confirmLabel="Remove account"
					busyLabel="Removing…"
					busy={removing}
					error={removeError}
				>
					<p>
						This deletes the account immediately. Balance history for this
						account goes with it.
					</p>
				</ConfirmDialog>
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
	// Finance-first: rows render from saved query rows alone. Literal
	// amounts show directly; formula-derived amounts stay Varies without
	// a forecast request. Memos stay mounted while rows load, so inputs
	// are null-safe; the null gate below only skips rendering.
	const rows = useMemo(
		() =>
			(transactionsQuery.data?.transactions ?? []).map((row) =>
				transactionToDisplay(row),
			),
		[transactionsQuery.data],
	);
	const visible = useMemo(
		() =>
			visibleTransactions({
				transactions: rows,
				accounts: accounts ?? [],
			}),
		[rows, accounts],
	);
	const recurringCount = visible.filter(
		(transaction) => transaction.frequency !== "once",
	).length;
	const transactionsCount = visible.filter(
		(transaction) => transaction.frequency === "once",
	).length;
	const tabs: TabItem<ScheduleFilter>[] = [
		{
			id: "all",
			label: "All transactions",
			count: transactionsCount,
		},
		{ id: "recurring", label: "Recurring", count: recurringCount },
	];
	const sortedTransactions = useMemo(
		() =>
			sortTransactionsByDate({
				items: visible.filter(
					(transaction) =>
						transaction.name.toLowerCase().includes(query.toLowerCase()) &&
						(schedule === "all"
							? transaction.frequency === "once"
							: transaction.frequency !== "once"),
				),
				getDate: (transaction) => transaction.startDate,
				getId: (transaction) => transaction.id,
				order,
			}),
		[visible, query, schedule, order],
	);
	if (!accounts || !startDate) return null;
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
			items={tabs}
			value={schedule}
			onChange={resetFilters}
			label="Transactions sections"
			panelAs="section"
		>
			<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4 max-sm:pb-4">
				<SearchField
					label="Search transactions"
					value={query}
					onChange={(event) => search(event.target.value)}
					placeholder="Find a transaction…"
				/>
				<div className="flex shrink-0 flex-wrap items-center gap-3">
					<TransactionSortButton order={order} onChange={changeOrder} />
					<Button
						type="button"
						variant="primary"
						size="sm"
						onClick={() => onEdit({ kind: "transaction", item: null })}
					>
						<Plus size={16} />
						Add transaction
					</Button>
				</div>
			</div>
			<div id={listId}>
				{transactionsQuery.isPending ? (
					<p role="status">Loading transactions…</p>
				) : transactionsQuery.isError ? (
					<p role="alert">
						Transactions could not be loaded.{" "}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => void transactionsQuery.refetch()}
						>
							Retry
						</Button>
					</p>
				) : (
					<TransactionsPanel
						transactions={pagedTransactions}
						accounts={visibleAccounts(accounts)}
						startDate={startDate}
						readOnly={readOnly}
					/>
				)}
			</div>
			{pageCount > 1 && (
				<TablePagination
					topBorder
					className="px-0.5"
					page={currentPage}
					pageCount={pageCount}
					total={sortedTransactions.length}
					pageSize={TRANSACTIONS_PAGE_SIZE}
					onPage={turnPage}
				/>
			)}
		</Tabs>
	);
}
