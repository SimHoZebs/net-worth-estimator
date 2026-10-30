import { useState } from "react";
import { AccountPage } from "../auth/AccountPage.tsx";
import { Tabs, type TabItem } from "../components/Tabs.tsx";
import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { useSavedAccounts } from "../state/savedRows.ts";
import { useTransactionCatalog } from "../state/workspaceResources.ts";
import { SyncSettings } from "./sources/SyncSettings.tsx";

type ConfigTab = "sync" | "amounts" | "account";

const configTabs: TabItem<ConfigTab>[] = [
	{ id: "sync", label: "Bank sync" },
	{ id: "amounts", label: "Amounts" },
	{ id: "account", label: "Account" },
];

export function SourcesPage() {
	// Everything subscribes here, including the access control.
	const [tab, setTab] = useState<ConfigTab>("sync");
	const savedAccounts = useSavedAccounts();
	const catalog = useTransactionCatalog().data;
	const readOnly = useUserReadOnly();
	if (!savedAccounts) return null;
	const accounts = savedAccounts.map((account) => ({
		id: account.id,
		name: account.name,
		kind: account.kind,
		color: account.color,
	}));
	const postings = (catalog?.items ?? []).map((item) => ({
		id: item.id,
		name: item.name,
	}));
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
					accounts={savedAccounts.map((account) => ({
						id: account.id,
						name: account.name,
					}))}
					postings={postings}
				/>
			)}
			{tab === "account" && <AccountPage />}
		</Tabs>
	);
}
