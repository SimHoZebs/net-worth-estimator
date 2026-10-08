import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { type TabItem, Tabs } from "../components/Tabs.tsx";
import type { Plan } from "../domain/model.ts";
import {
	type EditorTarget,
	type RemovalTarget,
	removePlanItem,
} from "../domain/planEdits.ts";
import { AccountsPanel, BalanceChecksPanel } from "./plan/AccountsPanel.tsx";
import { MovementsPanel } from "./plan/MovementsPanel.tsx";

export type PlanView = "accounts" | "transactions";
type AccountsSection = "accounts" | "checks";

type ScheduleFilter = "all" | "recurring";

export function PlanPage({
	plan,
	view,
	onEdit,
	onUpdate,
	onAccount,
}: {
	plan: Plan;
	view: PlanView;
	onEdit: (target: EditorTarget) => void;
	onUpdate: (plan: Plan) => boolean;
	onAccount: (id: string) => void;
}) {
	if (view === "accounts") {
		return (
			<AccountsView
				plan={plan}
				onEdit={onEdit}
				onUpdate={onUpdate}
				onAccount={onAccount}
			/>
		);
	}
	return <TransactionsView plan={plan} onEdit={onEdit} onUpdate={onUpdate} />;
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
	const [tab, setTab] = useState<AccountsSection>("accounts");
	const [query, setQuery] = useState("");
	const { requestRemoval, dialog } = usePlanRemoval({ plan, onUpdate });
	const tabs: TabItem<AccountsSection>[] = [
		{ id: "accounts", label: "Accounts", count: plan.accounts.length },
		{
			id: "checks",
			label: "Balance checks",
			count: plan.accounts.filter((account) => account.balanceCheck).length,
		},
	];
	const accounts = plan.accounts.filter((account) =>
		account.name.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<>
			<Tabs
				items={tabs}
				value={tab}
				onChange={(next) => {
					setTab(next);
					setQuery("");
				}}
				label="Accounts sections"
				panelAs="section"
				panelClassName="panel plan-panel"
			>
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
				{tab === "accounts" && (
					<AccountsPanel
						accounts={accounts}
						onAccount={onAccount}
						onEdit={(item) => onEdit({ kind: "account", item })}
						onRemove={(item) =>
							requestRemoval({ kind: "accounts", id: item.id, name: item.name })
						}
					/>
				)}
				{tab === "checks" && (
					<BalanceChecksPanel
						accounts={accounts}
						onEdit={(item) => onEdit({ kind: "account", item })}
					/>
				)}
			</Tabs>
			{dialog}
		</>
	);
}

function TransactionsView({
	plan,
	onEdit,
	onUpdate,
}: {
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
	onUpdate: (plan: Plan) => boolean;
}) {
	const [query, setQuery] = useState("");
	const [schedule, setSchedule] = useState<ScheduleFilter>("all");
	const { requestRemoval, dialog } = usePlanRemoval({ plan, onUpdate });
	const recurringCount = plan.movements.filter(
		(movement) => movement.frequency !== "once",
	).length;
	const tabs: TabItem<ScheduleFilter>[] = [
		{ id: "all", label: "All transactions", count: plan.movements.length },
		{ id: "recurring", label: "Recurring", count: recurringCount },
	];
	const movements = plan.movements.filter(
		(movement) =>
			movement.name.toLowerCase().includes(query.toLowerCase()) &&
			(schedule === "all" || movement.frequency !== "once"),
	);
	return (
		<>
			<Tabs
				items={tabs}
				value={schedule}
				onChange={(next) => {
					setSchedule(next);
					setQuery("");
				}}
				label="Transactions sections"
				panelAs="section"
				panelClassName="panel plan-panel"
			>
				<div className="plan-toolbar">
					<label className="search-field">
						<Search size={17} />
						<input
							aria-label="Search plan"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Find a transaction…"
						/>
					</label>
					<button
						type="button"
						className="button primary small"
						onClick={() => onEdit({ kind: "movement", item: null })}
					>
						<Plus size={16} />
						Add transaction
					</button>
				</div>
				<MovementsPanel
					movements={movements}
					accounts={plan.accounts}
					startDate={plan.startDate}
					onEdit={(item) => onEdit({ kind: "movement", item })}
					onRemove={(item) =>
						requestRemoval({
							kind: "movements",
							id: item.id,
							name: item.name,
						})
					}
				/>
			</Tabs>
			{dialog}
		</>
	);
}
