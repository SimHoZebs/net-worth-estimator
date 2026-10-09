import type { FinancialModelDocument, ServerStatus } from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
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
	onEdit,
}: {
	plan: Plan;
	workspace: Workspace;
	serverStatus?: ServerStatus | null;
	readOnly?: boolean;
	serverDocument?: FinancialModelDocument | null;
	onImportServerDocument: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
	onEdit: (target: EditorTarget) => void;
}) {
	const sourceAccess = readOnly ? "Read-only" : "Writable";
	return (
		<>
			<SourceBanner
				sourceAccess={sourceAccess}
				serverDocument={serverDocument}
			/>
			<IncomeEvidence plan={plan} />
			<AssumptionsPanel
				assumptions={plan.assumptions}
				onEdit={() => onEdit({ kind: "assumptions" })}
			/>
		</>
	);
}
