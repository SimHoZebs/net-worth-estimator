import { AccountPage } from "../auth/AccountPage.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
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
	return (
		<Tabs defaultValue="sync">
			<TabsList
				variant="line"
				scrollable
				aria-label="Configuration sections"
				className="mb-6 gap-6"
			>
				{configTabs.map((configTab) => (
					<TabsTrigger
						key={configTab.id}
						value={configTab.id}
						className="flex-none"
					>
						{configTab.label}
					</TabsTrigger>
				))}
			</TabsList>
			<TabsContent value="sync">
				<SyncSettings />
			</TabsContent>
			<TabsContent value="amounts">
				<AmountCatalog />
			</TabsContent>
			<TabsContent value="account">
				<AccountPage />
			</TabsContent>
			<TabsContent value="analysis">
				<AnalysisFindings />
			</TabsContent>
		</Tabs>
	);
}
