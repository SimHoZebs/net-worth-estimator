import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import type { Projection } from "../domain/result.ts";
import { ComparePage } from "../pages/ComparePage.tsx";
import { GoalsPage } from "../pages/GoalsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import { PlanPage } from "../pages/PlanPage.tsx";
import { SourcesPage } from "../pages/SourcesPage.tsx";
import type { Page } from "./navigation.ts";
import { ProjectionLoading } from "./ProjectionBoundary.tsx";
import type { WorkspaceShellProps } from "./types.ts";

type PageInputs = Pick<
	WorkspaceShellProps,
	| "workspace"
	| "plan"
	| "state"
	| "projection"
	| "savedProjection"
	| "years"
	| "setYears"
	| "ranges"
	| "setRanges"
	| "serverMode"
	| "serverStatus"
	| "serverDocument"
	| "onImportServerDocument"
	| "readOnly"
	| "retrySavedProjection"
>;

export function WorkspacePage({
	page,
	base,
	inputs,
	onEdit,
	onEvidence,
	onDiscard,
	onNavigate,
}: {
	page: Page;
	base: Projection;
	inputs: PageInputs;
	onEdit: (target: EditorTarget) => void;
	onEvidence: (target: EvidenceTarget) => void;
	onDiscard: () => void;
	onNavigate: (page: Page) => void;
}) {
	const {
		workspace,
		plan,
		state,
		projection,
		savedProjection,
		years,
		setYears,
		ranges,
		setRanges,
		serverMode = false,
		serverStatus = null,
		serverDocument = null,
		onImportServerDocument,
		readOnly = false,
		retrySavedProjection,
	} = inputs;
	switch (page) {
		case "outlook":
			return (
				<Outlook
					plan={plan}
					projection={base}
					range={projection.range}
					ranges={ranges}
					setRanges={setRanges}
					years={years}
					setYears={setYears}
					progress={projection.progress}
					rangeError={projection.rangeError}
					onEvidence={() => onEvidence({ kind: "position" })}
					onFailure={() => onEvidence({ kind: "failure" })}
					onAccount={(account) =>
						onEvidence({ kind: "account", id: account.id })
					}
					onPlan={() => onNavigate("plan")}
					onGoals={() => onNavigate("goals")}
					onGoal={(id) => onEvidence({ kind: "goal", id })}
					onTiming={() => onEvidence({ kind: "timing" })}
					onAssumptions={() => onEdit({ kind: "assumptions" })}
				/>
			);
		case "plan":
			return (
				<PlanPage
					plan={plan}
					onEdit={onEdit}
					onUpdate={state.updatePlan}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "goals":
			return (
				<GoalsPage
					plan={plan}
					projection={base}
					range={projection.range}
					onEdit={(item) => onEdit({ kind: "goal", item })}
					onUpdate={state.updatePlan}
					onEvidence={(id) => onEvidence({ kind: "goal", id })}
				/>
			);
		case "compare":
			if (!savedProjection)
				return (
					<ProjectionLoading
						label="Loading the saved server comparison"
						onRetry={retrySavedProjection}
					/>
				);
			if (savedProjection instanceof Error)
				return (
					<ErrorNotice
						message={savedProjection.message}
						action="Retry saved server calculation"
						onAction={retrySavedProjection}
					/>
				);
			return (
				<ComparePage
					saved={workspace.saved}
					plan={plan}
					projection={base}
					savedProjection={savedProjection}
					snapshot={workspace.snapshot}
					years={years}
					serverMode={serverMode}
					readOnly={readOnly}
					onCapture={state.capture}
					onSave={() => Promise.resolve(state.save())}
					onDiscard={onDiscard}
				/>
			);
		case "sources":
			return (
				<SourcesPage
					plan={plan}
					workspace={workspace}
					onReplace={state.replace}
					serverMode={serverMode}
					serverStatus={serverStatus}
					serverDocument={serverDocument}
					onImportServerDocument={onImportServerDocument}
					readOnly={readOnly}
				/>
			);
	}
}
