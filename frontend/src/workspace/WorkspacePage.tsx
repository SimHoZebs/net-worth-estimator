import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import { ComparePage } from "../pages/ComparePage.tsx";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import { PlanPage } from "../pages/PlanPage.tsx";
import { SourcesPage } from "../pages/SourcesPage.tsx";
import type { Page } from "./navigation.ts";

// Pure router: every page subscribes its own data where its queries are
// declared. Only UI callbacks (overlay and navigation actions) travel as
// props; no fetched data crosses this boundary.
export function WorkspacePage({
	page,
	onEdit,
	onEvidence,
	onDiscard,
	onNavigate,
}: {
	page: Page;
	onEdit: (target: EditorTarget) => void;
	onEvidence: (target: EvidenceTarget) => void;
	onDiscard: () => void;
	onNavigate: (page: Page) => void;
}) {
	switch (page) {
		case "outlook":
			return (
				<Outlook
					onEvidence={() => onEvidence({ kind: "position" })}
					onFailure={() => onEvidence({ kind: "failure" })}
					onTransactions={() => onNavigate("transactions")}
					onEvaluations={() => onNavigate("evaluations")}
					onEvaluation={(id) => onEvidence({ kind: "evaluation", id })}
					onEdit={onEdit}
				/>
			);
		case "accounts":
			return (
				<PlanPage
					key="accounts"
					view="accounts"
					onEdit={onEdit}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "transactions":
			return (
				<PlanPage
					key="transactions"
					view="transactions"
					onEdit={onEdit}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "evaluations":
			return (
				<EvaluationsPage
					onEdit={(item) => onEdit({ kind: "evaluation", item })}
					onEvidence={(id) => onEvidence({ kind: "evaluation", id })}
				/>
			);
		case "compare":
			return <ComparePage onDiscard={onDiscard} />;
		case "sources":
			return <SourcesPage />;
	}
}
