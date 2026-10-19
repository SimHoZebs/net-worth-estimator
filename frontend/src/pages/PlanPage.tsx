import { Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TransactionSortButton } from "../components/activity/TransactionSortButton.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { TablePagination } from "../components/DataTable.tsx";
import { type TabItem, Tabs } from "../components/Tabs.tsx";
import { ErrorNotice, ProjectionUpdating } from "../components/ui.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../domain/transactionSort.ts";
import {
	type Plan,
	visibleAccounts,
	visibleMovements,
} from "../domain/model.ts";
import {
	type EditorTarget,
	type RemovalTarget,
	removePlanItem,
} from "../domain/planEdits.ts";
import { resolveMovementAmounts } from "../domain/resolvedMovementAmounts.ts";
import type { Projection } from "../domain/result.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { AccountsPanel } from "./plan/AccountsPanel.tsx";
import { MovementsPanel } from "./plan/MovementsPanel.tsx";

export type PlanView = "accounts" | "transactions";

type ScheduleFilter = "all" | "recurring";

const TRANSACTIONS_PAGE_SIZE = 10;

export function PlanPage({
	view,
	onEdit,
	onAccount,
}: {
	view: PlanView;
	onEdit: (target: EditorTarget) => void;
	onAccount: (id: string) => void;
}) {
	// Plan data and actions subscribe here; only the viewed tab and UI
	// callbacks arrive as props.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	if (!plan) return null;
	if (view === "accounts") {
		return (
			<AccountsView
				plan={plan}
				onEdit={onEdit}
				onUpdate={updatePlan}
				onAccount={onAccount}
			/>
		);
	}
	return <TransactionsWithProjection plan={plan} onEdit={onEdit} />;
}

// The transaction list resolves realized amounts from the projection, so it
// subscribes with scenarios disabled: the range stream would only duplicate
// the page that actually charts it.
function TransactionsWithProjection({
	plan,
	onEdit,
}: {
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
}) {
	const projection = useRemoteProjection({ ranges: false });
	const baseLoadError =
		projection.base instanceof Error && !projection.loading
			? projection.base
			: null;
	const base =
		projection.base instanceof Error || projection.base === null
			? null
			: projection.base;
	return (
		<>
			{baseLoadError && (
				<ErrorNotice
					message={baseLoadError.message}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.baseError && base && (
				<ErrorNotice
					message={projection.baseError}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.loading && base && <ProjectionUpdating />}
			<TransactionsView plan={plan} projection={base} onEdit={onEdit} />
		</>
	);
}

function usePlanRemoval({
	plan,
	onUpdate,
}: {
	plan: Plan;
	onUpdate: (plan: Plan) => boolean;
}) {
	const [remove, setRemove] = useState<RemovalTarget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const requestRemoval = (target: RemovalTarget) => {
		setRemove(target);
		setError(null);
	};
	const deleteItem = () => {
		if (!remove) return;
		const next = removePlanItem({ plan, target: remove });
		if (next instanceof Error) {
			setError(next.message);
			return;
		}
		if (onUpdate(next)) {
			setRemove(null);
			setError(null);
		}
	};
	const dialog = remove && (
		<ConfirmDialog
			title={`Remove ${remove.name}?`}
			eyebrow="Changes"
			onCancel={() => setRemove(null)}
			onConfirm={deleteItem}
			cancelLabel="Keep item"
			confirmLabel="Remove from unsaved changes"
			error={error}
		>
			<p>
				The item will be marked as removed in your changes. Your saved plan
				stays intact until you explicitly save.
			</p>
		</ConfirmDialog>
	);
	return { requestRemoval, dialog };
}

function AccountsView({
	plan,
	onEdit,
	onUpdate,
	onAccount,
}: {
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
	onUpdate: (plan: Plan) => boolean;
	onAccount: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const { requestRemoval, dialog } = usePlanRemoval({ plan, onUpdate });
	const visible = visibleAccounts(plan.accounts);
	const accounts = visible.filter((account) =>
		account.name.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<>
			<section className="panel plan-panel">
				<div className="plan-toolbar">
					<label className="search-field">
						<Search size={17} />
						<input
							aria-label="Search plan"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Find an account…"
						/>
					</label>
					<button
						type="button"
						className="button primary small"
						onClick={() => onEdit({ kind: "account", item: null })}
					>
						<Plus size={16} />
						Add account
					</button>
				</div>
				<AccountsPanel
					accounts={accounts}
					onAccount={onAccount}
					onEdit={(item) => onEdit({ kind: "account", item })}
					onRemove={(item) =>
						requestRemoval({ kind: "accounts", id: item.id, name: item.name })
					}
				/>
			</section>
			{dialog}
		</>
	);
}

function TransactionsView({
	plan,
	projection,
	onEdit,
}: {
	plan: Plan;
	projection?: Projection | null;
	onEdit: (target: EditorTarget) => void;
}) {
	const [query, setQuery] = useState("");
	const [schedule, setSchedule] = useState<ScheduleFilter>("all");
	const [order, setOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	const [page, setPage] = useState(0);
	const listId = useId();
	const resolvedAmounts = useMemo(
		() =>
			projection ? resolveMovementAmounts(projection.movements) : new Map(),
		[projection],
	);
	const visible = useMemo(
		() =>
			visibleMovements({
				movements: plan.movements,
				accounts: plan.accounts,
			}),
		[plan.movements, plan.accounts],
	);
	const recurringCount = visible.filter(
		(movement) => movement.frequency !== "once",
	).length;
	const tabs: TabItem<ScheduleFilter>[] = [
		{ id: "all", label: "All transactions", count: visible.length },
		{ id: "recurring", label: "Recurring", count: recurringCount },
	];
	const movements = useMemo(
		() =>
			sortTransactionsByDate({
				items: visible.filter(
					(movement) =>
						movement.name.toLowerCase().includes(query.toLowerCase()) &&
						(schedule === "all" || movement.frequency !== "once"),
				),
				getDate: (movement) => movement.startDate,
				getId: (movement) => movement.id,
				order,
			}),
		[visible, query, schedule, order],
	);
	const pageCount = Math.max(
		1,
		Math.ceil(movements.length / TRANSACTIONS_PAGE_SIZE),
	);
	const currentPage = Math.min(page, pageCount - 1);
	const pagedMovements = movements.slice(
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
			panelClassName="plan-transactions"
		>
			<div className="plan-toolbar">
				<label className="search-field">
					<Search size={17} />
					<input
						aria-label="Search plan"
						value={query}
						onChange={(event) => search(event.target.value)}
						placeholder="Find a transaction…"
					/>
				</label>
				<div className="plan-toolbar-actions">
					<TransactionSortButton order={order} onChange={changeOrder} />
					<button
						type="button"
						className="button primary small"
						onClick={() => onEdit({ kind: "movement", item: null })}
					>
						<Plus size={16} />
						Add transaction
					</button>
				</div>
			</div>
			<div id={listId}>
				<MovementsPanel
					movements={pagedMovements}
					accounts={visibleAccounts(plan.accounts)}
					plan={plan}
					resolvedAmounts={resolvedAmounts}
				/>
			</div>
			{pageCount > 1 && (
				<TablePagination
					page={currentPage}
					pageCount={pageCount}
					total={movements.length}
					pageSize={TRANSACTIONS_PAGE_SIZE}
					onPage={turnPage}
				/>
			)}
		</Tabs>
	);
}
