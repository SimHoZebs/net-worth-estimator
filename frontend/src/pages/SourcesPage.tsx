import type { FinancialModelDocument, ServerStatus } from "../api/index.ts";
import { ErrorNotice } from "../components/ui.tsx";
import type { Plan } from "../domain/model.ts";
import type { Workspace } from "../state/storage.ts";
import { useModelImport } from "../state/useModelImport.ts";
import { BalanceProvenance } from "./sources/BalanceProvenance.tsx";
import { IncomeEvidence } from "./sources/IncomeEvidence.tsx";
import { SourceBanner, SourceHealth } from "./sources/SourceHealth.tsx";
import { SourceImportPreview } from "./sources/SourceImportPreview.tsx";
import { SourcePortability } from "./sources/SourcePortability.tsx";

export function SourcesPage({
	plan,
	workspace,
	onReplace,
	serverMode = false,
	serverStatus = null,
	readOnly = workspace.saved.readOnly || Boolean(serverStatus?.readOnly),
	serverDocument = null,
	onImportServerDocument,
}: {
	plan: Plan;
	workspace: Workspace;
	onReplace: (plan: Plan) => boolean;
	serverMode?: boolean;
	serverStatus?: ServerStatus | null;
	readOnly?: boolean;
	serverDocument?: FinancialModelDocument | null;
	onImportServerDocument?: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
}) {
	const controller = useModelImport({
		plan,
		workspace,
		onReplace,
		serverMode,
		readOnly,
		serverDocument,
		onImportServerDocument,
	});
	const sourceAccess = readOnly
		? "Read-only server"
		: serverStatus?.authEnabled
			? "Auth required"
			: serverMode
				? "Writable server"
				: "Writable local copy";
	const hasDraft = Boolean(workspace.draft);
	const canImportServer = Boolean(onImportServerDocument);
	return (
		<>
			<SourceBanner
				plan={plan}
				serverMode={serverMode}
				sourceAccess={sourceAccess}
			/>
			{controller.error && <ErrorNotice message={controller.error} />}
			<div className="sources-grid">
				<SourceHealth
					plan={plan}
					workspace={workspace}
					serverMode={serverMode}
					serverDocument={serverDocument}
					sourceAccess={sourceAccess}
				/>
				<SourcePortability
					serverMode={serverMode}
					hasDraft={hasDraft}
					hasServerDocument={Boolean(serverDocument)}
					canImportServer={canImportServer}
					readOnly={readOnly}
					controller={controller}
				/>
			</div>
			<BalanceProvenance plan={plan} serverMode={serverMode} />
			<IncomeEvidence plan={plan} serverMode={serverMode} />
			<SourceImportPreview
				hasDraft={hasDraft}
				canImportServer={canImportServer}
				readOnly={readOnly}
				controller={controller}
			/>
		</>
	);
}
