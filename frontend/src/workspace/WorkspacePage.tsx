import { lazy } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import type { Page } from "./navigation.ts";

// Outlook is the landing route and stays in the entry chunk so its summary
// can render as soon as the shell does. Every other route is a separate
// chunk: boot transfers and parses only the screen the user opened.
const AccountsPage = lazy(() =>
	import("../pages/AccountsPage.tsx").then((module) => ({
		default: module.AccountsPage,
	})),
);
const TransactionsPage = lazy(() =>
	import("../pages/TransactionsPage.tsx").then((module) => ({
		default: module.TransactionsPage,
	})),
);
const PurchasesPage = lazy(() =>
	import("../pages/PurchasesPage.tsx").then((module) => ({
		default: module.PurchasesPage,
	})),
);
const FlowsPage = lazy(() =>
	import("../pages/flows/FlowsPage.tsx").then((module) => ({
		default: module.FlowsPage,
	})),
);
const EvaluationsPage = lazy(() =>
	import("../pages/EvaluationsPage.tsx").then((module) => ({
		default: module.EvaluationsPage,
	})),
);
const GroupsPage = lazy(() =>
	import("../pages/GroupsPage.tsx").then((module) => ({
		default: module.GroupsPage,
	})),
);
const InboxPage = lazy(() =>
	import("../pages/InboxPage.tsx").then((module) => ({
		default: module.InboxPage,
	})),
);
const SourcesPage = lazy(() =>
	import("../pages/SourcesPage.tsx").then((module) => ({
		default: module.SourcesPage,
	})),
);

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
		case "flows":
			return <FlowsPage />;
		case "evaluations":
			return (
				<EvaluationsPage
					onEdit={(item) => onEdit({ kind: "evaluation", item })}
				/>
			);
		case "groups":
			return <GroupsPage />;
		case "inbox":
			return <InboxPage />;
		case "sources":
			return <SourcesPage />;
	}
}
