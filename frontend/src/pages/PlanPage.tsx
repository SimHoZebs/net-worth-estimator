import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { type TabItem, Tabs } from "../components/Tabs.tsx";
import type { Plan } from "../domain/model.ts";
import {
	type EditorTarget,
	type RemovalTarget,
	removePlanItem,
	toggleMovement,
} from "../domain/planEdits.ts";
import { AccountsPanel, BalanceChecksPanel } from "./plan/AccountsPanel.tsx";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { MovementsPanel } from "./plan/MovementsPanel.tsx";

type Section = "accounts" | "movements" | "checks" | "assumptions";
export function PlanPage({
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
	const [tab, setTab] = useState<Section>("accounts");
	const [query, setQuery] = useState("");
	const [remove, setRemove] = useState<RemovalTarget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tabs: TabItem<Section>[] = [
		{ id: "accounts", label: "Accounts", count: plan.accounts.length },
		{ id: "movements", label: "Movements", count: plan.movements.length },
		{
			id: "checks",
			label: "Balance checks",
			count: plan.accounts.filter(
				(account) => account.provenance === "recorded",
			).length,
		},
		{ id: "assumptions", label: "Assumptions" },
	];
	const accounts = plan.accounts.filter((account) =>
		account.name.toLowerCase().includes(query.toLowerCase()),
	);
	const movements = plan.movements.filter((movement) =>
		movement.name.toLowerCase().includes(query.toLowerCase()),
	);
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
	return (
		<>
			<Tabs
				items={tabs}
				value={tab}
				onChange={(next) => {
					setTab(next);
					setQuery("");
				}}
				label="Plan sections"
				panelAs="section"
				panelClassName="panel plan-panel"
			>
				{tab !== "assumptions" && (
					<div className="plan-toolbar">
						<label className="search-field">
							<Search size={17} />
							<input
								aria-label="Search plan"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={`Find ${tab === "movements" ? "a movement" : "an account"}…`}
							/>
						</label>
						<button
							type="button"
							className="button primary small"
							onClick={() =>
								onEdit({
									kind: tab === "movements" ? "movement" : "account",
									item: null,
								})
							}
						>
							<Plus size={16} />
							Add {tab === "movements" ? "movement" : "account"}
						</button>
					</div>
				)}
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
				{tab === "movements" && (
					<MovementsPanel
						movements={movements}
						accounts={plan.accounts}
						onEdit={(item) => onEdit({ kind: "movement", item })}
						onRemove={(item) =>
							requestRemoval({
								kind: "movements",
								id: item.id,
								name: item.name,
							})
						}
						onToggle={(id) => onUpdate(toggleMovement({ plan, id }))}
					/>
				)}
				{tab === "checks" && (
					<BalanceChecksPanel
						accounts={accounts}
						onEdit={(item) => onEdit({ kind: "account", item })}
					/>
				)}
				{tab === "assumptions" && (
					<AssumptionsPanel
						assumptions={plan.assumptions}
						onEdit={() => onEdit({ kind: "assumptions" })}
					/>
				)}
			</Tabs>
			{remove && (
				<ConfirmDialog
					title={`Remove ${remove.name}?`}
					eyebrow="Temporary version"
					onCancel={() => setRemove(null)}
					onConfirm={deleteItem}
					cancelLabel="Keep item"
					confirmLabel="Remove from temporary version"
					error={error}
				>
					<p>
						The item will be marked as removed in your changes. Your saved plan
						stays intact until you explicitly save.
					</p>
				</ConfirmDialog>
			)}
		</>
	);
}
