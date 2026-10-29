import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { GroupsPage } from "../pages/GroupsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { AccountsPage } from "../pages/AccountsPage.tsx";
import { TransactionsPage } from "../pages/TransactionsPage.tsx";
import { PurchasesPage } from "../pages/PurchasesPage.tsx";
import { SourcesPage } from "../pages/SourcesPage.tsx";
import type { Page } from "./navigation.ts";

// Pure router: every page subscribes its own data where its queries are
// declared. Only UI callbacks (overlay and navigation actions) travel as
// props; no fetched data crosses this boundary.
export function WorkspacePage({
	page,
	onEdit,
	onEvidence,
	onNavigate,
	safeSpendingDetail,
	onSafeSpendingDetail,
	onSafeSpendingTab,
}: {
	page: Page;
	onEdit: (target: EditorTarget) => void;
	onEvidence: (target: EvidenceTarget) => void;
	onNavigate: (page: Page) => void;
	safeSpendingDetail: SafeSpendingDetailTab | null;
	onSafeSpendingDetail: (tab: SafeSpendingDetailTab | null) => void;
	onSafeSpendingTab: (tab: SafeSpendingDetailTab) => void;
}) {
	switch (page) {
		case "outlook":
			return (
				<Outlook
					onAddAccount={() => onEdit({ kind: "account", item: null })}
					onEvidence={() => onEvidence({ kind: "position" })}
					onFailure={() => onEvidence({ kind: "failure" })}
					onTransactions={() => onNavigate("transactions")}
					safeSpendingDetail={safeSpendingDetail}
					onSafeSpendingDetail={onSafeSpendingDetail}
					onSafeSpendingTab={onSafeSpendingTab}
				/>
			);
		case "accounts":
			return (
				<AccountsPage
					key="accounts"
					onEdit={onEdit}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "transactions":
			return (
				<TransactionsPage
					key="transactions"
					onEdit={onEdit}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "purchases":
			return <PurchasesPage />;
		case "evaluations":
			return (
				<EvaluationsPage
					onEdit={(item) => onEdit({ kind: "evaluation", item })}
				/>
			);
		case "groups":
			return <GroupsPage />;
		case "sources":
			return <SourcesPage />;
	}
}
