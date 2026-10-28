import { useState } from "react";
import { AccountPage } from "../auth/AccountPage.tsx";
import { Tabs, type TabItem } from "../components/Tabs.tsx";
import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import { stageAndSave } from "../state/workspaceWrites.ts";
import { usePlan, useWorkspaceReadOnly } from "../state/useWorkspacePlan.ts";
import { useServerModel } from "../state/workspaceResources.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { SyncSettings } from "./sources/SyncSettings.tsx";

type ConfigTab = "sync" | "amounts" | "assumptions" | "account";

const configTabs: TabItem<ConfigTab>[] = [
	{ id: "sync", label: "Bank sync" },
	{ id: "amounts", label: "Amounts" },
	{ id: "assumptions", label: "Assumptions" },
	{ id: "account", label: "Account" },
];

export function SourcesPage() {
	// Everything subscribes here, including the access control.
	const [tab, setTab] = useState<ConfigTab>("sync");
	const plan = usePlan();
	const serverDocument = useServerModel().data?.document;
	const readOnly = useWorkspaceReadOnly();
	const onUpdatePlan = stageAndSave;
	if (!plan) return null;
	const accounts = plan.accounts.map((account) => ({
		id: account.id,
		name: account.name,
		kind: account.kind,
		color: account.color,
	}));
	const postings = [
		...(serverDocument?.recurrenceRules ?? []).map((rule) => ({
			id: rule.id,
			name: rule.name,
		})),
		...(serverDocument?.postings ?? []).map((posting) => ({
			id: posting.id,
			name: posting.name,
		})),
	];
	return (
		<Tabs
			items={configTabs}
			value={tab}
			onChange={setTab}
			label="Configuration sections"
			panelAs="section"
		>
			{tab === "sync" && (
				<SyncSettings accounts={accounts} readOnly={readOnly} />
			)}
			{tab === "amounts" && (
				<AmountCatalog
					accounts={plan.accounts.map((account) => ({
						id: account.id,
						name: account.name,
					}))}
					postings={postings}
				/>
			)}
			{tab === "assumptions" && (
				<AssumptionsPanel plan={plan} onUpdate={onUpdatePlan} />
			)}
			{tab === "account" && <AccountPage />}
		</Tabs>
	);
}
