import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import type { TimingDetailTab } from "../pages/outlook/TimingDetailDialog.tsx";
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
	onNavigate,
	timingDetail,
	onTimingDetail,
	onTimingTab,
}: {
	page: Page;
	onEdit: (target: EditorTarget) => void;
	onEvidence: (target: EvidenceTarget) => void;
	onNavigate: (page: Page) => void;
	timingDetail: TimingDetailTab | null;
	onTimingDetail: (tab: TimingDetailTab | null) => void;
	onTimingTab: (tab: TimingDetailTab) => void;
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
					timingDetail={timingDetail}
					onTimingDetail={onTimingDetail}
					onTimingTab={onTimingTab}
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
		case "sources":
			return <SourcesPage />;
	}
}
