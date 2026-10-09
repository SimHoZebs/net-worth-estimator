import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import { ErrorNotice, ProjectionUpdating } from "../components/ui.tsx";
import type { Projection } from "../domain/result.ts";
import { ComparePage } from "../pages/ComparePage.tsx";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { Outlook } from "../pages/Outlook.tsx";
import { PlanPage } from "../pages/PlanPage.tsx";
import { SourcesPage } from "../pages/SourcesPage.tsx";
import type { Page } from "./navigation.ts";
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
	// Pages take a nullable projection and skeletonize their own data slots.
	// Error notices are terminal states with retry; pending data never blocks.
	// Failures always resolve with loading=false, so an error under load is
	// superseded by the pending skeletons instead of flashing a stale error.
	const base: Projection | null =
		projection.base instanceof Error ? null : projection.base;
	const baseLoadError: Error | null =
		projection.base instanceof Error && !projection.loading
			? projection.base
			: null;
	const rangeNotice = (key: string) =>
		projection.rangeError && ranges ? (
			<ErrorNotice
				key={key}
				message={projection.rangeError}
				action="Retry scenario calculation"
				onAction={projection.retryRange}
			/>
		) : null;
	switch (page) {
		case "outlook":
			return (
				<>
					{baseLoadError && (
						<ErrorNotice
							message={baseLoadError.message}
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
					{rangeNotice("outlook-range")}
					{projection.loading && base && <ProjectionUpdating />}
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
				</>
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
			return (
				<>
					{baseLoadError && (
						<ErrorNotice
							message={baseLoadError.message}
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
				<>
					{baseLoadError && (
						<ErrorNotice
							message={baseLoadError.message}
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
					{rangeNotice("evaluations-range")}
					{projection.loading && base && <ProjectionUpdating />}
					<EvaluationsPage
						plan={plan}
						projection={base}
						range={projection.range}
						onEdit={(item) => onEdit({ kind: "evaluation", item })}
						onUpdate={state.updatePlan}
						onEvidence={(id) => onEvidence({ kind: "evaluation", id })}
					/>
				</>
			);
		case "compare": {
			// The saved projection only runs against a draft; without one it
			// aliases the active projection, so its error notice is gated on
			// having a draft to avoid duplicating the base notice.
			const hasDraft = workspace.draft !== null;
			const saved: Projection | null =
				savedProjection instanceof Error || savedProjection === null
					? null
					: savedProjection;
			return (
				<>
					{baseLoadError && (
						<ErrorNotice
							message={baseLoadError.message}
							action="Retry calculation"
							onAction={projection.retryProjection}
						/>
					)}
					{hasDraft && savedProjection instanceof Error && (
						<ErrorNotice
							message={savedProjection.message}
							action="Retry saved calculation"
							onAction={retrySavedProjection}
						/>
					)}
					{projection.baseError && base && (
						<ErrorNotice
							message={projection.baseError}
							action="Retry calculation"
							onAction={projection.retryProjection}
						/>
					)}
					{rangeNotice("compare-range")}
					{projection.loading && base && <ProjectionUpdating />}
					<ComparePage
						saved={workspace.saved}
						plan={plan}
						projection={base}
						savedProjection={saved}
						snapshot={workspace.snapshot}
						years={years}
						readOnly={readOnly}
						onCapture={state.capture}
						onSave={() => Promise.resolve(state.save())}
						onDiscard={onDiscard}
					/>
				</>
			);
		}
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
