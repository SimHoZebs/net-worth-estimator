import { useState } from "react";
import { AccountPage } from "../auth/AccountPage.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import { SyncSettings } from "./sources/SyncSettings.tsx";
import { AnalysisFindings } from "./sources/AnalysisFindings.tsx";

type ConfigTab = "sync" | "amounts" | "analysis" | "account";

const configTabs: Array<{ id: ConfigTab; label: string }> = [
	{ id: "sync", label: "Bank sync" },
	{ id: "amounts", label: "Amounts" },
	{ id: "analysis", label: "Analysis" },
	{ id: "account", label: "Account" },
];

export function SourcesPage() {
	// Tabs own UI state; each panel subscribes to its own queries.
	const [tab, setTab] = useState<ConfigTab>("sync");
	return (
		<Tabs value={tab} onValueChange={(next) => setTab(next as ConfigTab)}>
			<TabsList
				variant="line"
				aria-label="Configuration sections"
				className="mb-6 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0"
			>
				{configTabs.map((configTab) => (
					<TabsTrigger
						key={configTab.id}
						value={configTab.id}
						className="flex-none px-0.5 pt-3 pb-4"
					>
						{configTab.label}
					</TabsTrigger>
				))}
			</TabsList>
			<section>
				{tab === "sync" && <SyncSettings />}
				{tab === "amounts" && <AmountCatalog />}
				{tab === "account" && <AccountPage />}
				{tab === "analysis" && <AnalysisFindings />}
			</section>
		</Tabs>
	);
}
