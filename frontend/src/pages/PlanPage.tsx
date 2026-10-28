import { Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TransactionSortButton } from "../components/activity/TransactionSortButton.tsx";
import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { AccountCardGrid } from "../components/cards/AccountCardGrid.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { TablePagination } from "../components/DataTable.tsx";
import { Button } from "../components/Button.tsx";
import { SearchField } from "../components/Field.tsx";
import { type TabItem, Tabs } from "../components/Tabs.tsx";
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
import { usePlan } from "../state/useWorkspacePlan.ts";
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
	const plan = usePlan();
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
	return (
		<BaseProjectionView>
			{({ base }) => (
				<TransactionsView plan={plan} projection={base} onEdit={onEdit} />
			)}
		</BaseProjectionView>
	);
}

function AccountsWithProjection({
	plan,
	query,
}: {
	plan: Plan;
	query: string;
}) {
	const projection = useRemoteProjection({ ranges: false });
	const base =
		projection.base instanceof Error || projection.base === null
			? null
			: projection.base;
	return <AccountCardGrid plan={plan} projection={base} query={query} />;
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
			{remove.kind === "movements" && (
				<p>
					Saving this removal also deletes any receipts attached to the
					transaction.
				</p>
			)}
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
			<AccountsWithProjection plan={plan} query={query} />
			<section>
				<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4">
					<SearchField
						label="Search plan"
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
	const transactionsCount = visible.filter(
		(movement) =>
			movement.frequency === "once" && movement.purchasePriority == null,
	).length;
	const tabs: TabItem<ScheduleFilter>[] = [
		{
			id: "all",
			label: "All transactions",
			count: transactionsCount,
		},
		{ id: "recurring", label: "Recurring", count: recurringCount },
	];
	const movements = useMemo(
		() =>
			sortTransactionsByDate({
				items: visible.filter(
					(movement) =>
						movement.purchasePriority == null &&
						movement.name.toLowerCase().includes(query.toLowerCase()) &&
						(schedule === "all"
							? movement.frequency === "once"
							: movement.frequency !== "once"),
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
		>
			<div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-4 max-sm:pb-4">
				<SearchField
					label="Search plan"
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
						onClick={() => onEdit({ kind: "movement", item: null })}
					>
						<Plus size={16} />
						Add transaction
					</Button>
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
					topBorder
					className="px-0.5"
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
