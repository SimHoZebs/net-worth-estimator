import { useState } from "react";
import { AccountPage } from "../auth/AccountPage.tsx";
import { Tabs, type TabItem } from "../components/Tabs.tsx";
import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import { SyncSettings } from "./sources/SyncSettings.tsx";
import { AnalysisFindings } from "./sources/AnalysisFindings.tsx";

type ConfigTab = "sync" | "amounts" | "analysis" | "account";

const configTabs: TabItem<ConfigTab>[] = [
	{ id: "sync", label: "Bank sync" },
	{ id: "amounts", label: "Amounts" },
	{ id: "analysis", label: "Analysis" },
	{ id: "account", label: "Account" },
];

export function SourcesPage() {
	// Tabs own UI state; each panel subscribes to its own queries.
	const [tab, setTab] = useState<ConfigTab>("sync");
	return (
		<Tabs
			items={configTabs}
			value={tab}
			onChange={setTab}
			label="Configuration sections"
			panelAs="section"
		>
			{tab === "sync" && <SyncSettings />}
			{tab === "amounts" && <AmountCatalog />}
			{tab === "account" && <AccountPage />}
			{tab === "analysis" && <AnalysisFindings />}
		</Tabs>
	);
}
