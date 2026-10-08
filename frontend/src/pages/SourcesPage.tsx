import type { ReactNode } from "react";
import type { FinancialModelDocument, ServerStatus } from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Workspace } from "../state/storage.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { BalanceProvenance } from "./sources/BalanceProvenance.tsx";
import { IncomeEvidence } from "./sources/IncomeEvidence.tsx";
import { SourceBanner } from "./sources/SourceHealth.tsx";
import "./sources/sources.css";

export function SourcesPage({
	plan,
	workspace,
	serverStatus = null,
	readOnly = workspace.saved.readOnly || Boolean(serverStatus?.readOnly),
	serverDocument = null,
	authControl = null,
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
	authControl?: ReactNode;
	authRequired?: boolean;
	authTokenActive?: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const sourceAccess = readOnly
		? "Read-only"
		: serverStatus?.authEnabled
			? "Auth required"
			: "Writable";
	return (
		<>
			<SourceBanner
				sourceAccess={sourceAccess}
				serverDocument={serverDocument}
			/>
			<section
				className="panel portability"
				aria-labelledby="server-access-heading"
				style={{ marginBottom: 22 }}
			>
				<h2 id="server-access-heading">Access</h2>
				<p>
					Protected saves use a bearer token that stays in this tab’s memory
					only. Enter it here when the server requires authentication.
				</p>
				{authControl}
			</section>
			<BalanceProvenance plan={plan} />
			<IncomeEvidence plan={plan} />
			<AssumptionsPanel
				assumptions={plan.assumptions}
				onEdit={() => onEdit({ kind: "assumptions" })}
			/>
		</>
	);
}
