import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import { ComparePage } from "../pages/ComparePage.tsx";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import { PlanPage } from "../pages/PlanPage.tsx";
import { SourcesPage } from "../pages/SourcesPage.tsx";
import type { Page } from "./navigation.ts";
import {
	ProjectionBoundary,
	ProjectionLoading,
	ProjectionUpdating,
} from "./ProjectionBoundary.tsx";
import type { ProjectionState, WorkspaceShellProps } from "./types.ts";

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
	| "serverStatus"
	| "serverDocument"
	| "onImportServerDocument"
	| "readOnly"
	| "retrySavedProjection"
	| "authControl"
	| "authRequired"
	| "authTokenActive"
>;

export function WorkspacePage({
	page,
	projection,
	inputs,
	onEdit,
	onEvidence,
	onDiscard,
	onNavigate,
}: {
	page: Page;
	projection: ProjectionState;
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
		savedProjection,
		years,
		setYears,
		ranges,
		setRanges,
		serverStatus = null,
		serverDocument = null,
		onImportServerDocument,
		readOnly = false,
		retrySavedProjection,
	} = inputs;
	switch (page) {
		case "outlook":
			return (
				<ProjectionBoundary projection={projection} ranges={ranges}>
					{(base) => (
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
							onTransactions={() => onNavigate("transactions")}
							onEvaluations={() => onNavigate("evaluations")}
							onEvaluation={(id) => onEvidence({ kind: "evaluation", id })}
							onEdit={onEdit}
						/>
					)}
				</ProjectionBoundary>
			);
		case "accounts":
			return (
				<PlanPage
					key="accounts"
					plan={plan}
					view="accounts"
					onEdit={onEdit}
					onUpdate={state.updatePlan}
					onAccount={(id) => onEvidence({ kind: "account", id })}
				/>
			);
		case "transactions": {
			// Transactions render from the plan directly; projection only resolves
			// realized amounts. Never block this page on the calculation.
			const base =
				projection.base && !(projection.base instanceof Error)
					? projection.base
					: null;
			return (
				<>
					{projection.base instanceof Error && (
						<ErrorNotice
							message={projection.base.message}
							action="Retry calculation"
							onAction={projection.retryProjection}
						/>
					)}
					{projection.baseError && base && (
						<ErrorNotice
							message={projection.baseError}
							action="Retry calculation"
							onAction={projection.retryProjection}
						/>
					)}
					{projection.loading && base && <ProjectionUpdating />}
					<PlanPage
						key="transactions"
						plan={plan}
						view="transactions"
						projection={base}
						onEdit={onEdit}
						onUpdate={state.updatePlan}
						onAccount={(id) => onEvidence({ kind: "account", id })}
					/>
				</>
			);
		}
		case "evaluations":
			return (
				<ProjectionBoundary projection={projection} ranges={ranges}>
					{(base) => (
						<EvaluationsPage
							plan={plan}
							projection={base}
							range={projection.range}
							onEdit={(item) => onEdit({ kind: "evaluation", item })}
							onUpdate={state.updatePlan}
							onEvidence={(id) => onEvidence({ kind: "evaluation", id })}
						/>
					)}
				</ProjectionBoundary>
			);
		case "compare":
			return (
				<ProjectionBoundary projection={projection} ranges={ranges}>
					{(base) => {
						if (!savedProjection)
							return (
								<ProjectionLoading
									label="Loading the saved comparison"
									onRetry={retrySavedProjection}
								/>
							);
						if (savedProjection instanceof Error)
							return (
								<ErrorNotice
									message={savedProjection.message}
									action="Retry saved calculation"
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
								readOnly={readOnly}
								onCapture={state.capture}
								onSave={() => Promise.resolve(state.save())}
								onDiscard={onDiscard}
							/>
						);
					}}
				</ProjectionBoundary>
			);
		case "sources":
			return (
				<SourcesPage
					plan={plan}
					workspace={workspace}
					serverStatus={serverStatus}
					serverDocument={serverDocument}
					onImportServerDocument={onImportServerDocument}
					readOnly={readOnly}
					onUpdatePlan={state.updatePlan}
				/>
			);
	}
}
