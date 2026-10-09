import type { FinancialModelDocument, ServerStatus } from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import type { Workspace } from "../state/storage.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { IncomeEvidence } from "./sources/IncomeEvidence.tsx";
import { SourceBanner } from "./sources/SourceHealth.tsx";
import "./sources/sources.css";

export function SourcesPage({
	plan,
	workspace,
	serverStatus = null,
	readOnly = workspace.saved.readOnly || Boolean(serverStatus?.readOnly),
	serverDocument = null,
	onUpdatePlan,
}: {
	plan: Plan;
	workspace: Workspace;
	serverStatus?: ServerStatus | null;
	readOnly?: boolean;
	serverDocument?: FinancialModelDocument | null;
	onImportServerDocument: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
	onUpdatePlan: (plan: Plan) => boolean;
}) {
	const sourceAccess = readOnly ? "Read-only" : "Writable";
	return (
		<>
			<SourceBanner
				sourceAccess={sourceAccess}
				serverDocument={serverDocument}
			/>
			<IncomeEvidence plan={plan} />
			<AssumptionsPanel plan={plan} onUpdate={onUpdatePlan} />
		</>
	);
}
