import { RemoteAuthControl } from "../app/RemoteAuthControl.tsx";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { IncomeEvidence } from "./sources/IncomeEvidence.tsx";
import { SourceBanner } from "./sources/SourceHealth.tsx";
import "./sources/sources.css";

export function SourcesPage() {
	// Everything subscribes here, including the access control.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const statusReadOnly = useWorkspaceStore(
		(state) => state.status?.readOnly ?? false,
	);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const onUpdatePlan = useWorkspaceStore((state) => state.updatePlan);
	if (!workspace || !plan) return null;
	const readOnly = statusReadOnly || writeBlocked || workspace.saved.readOnly;
	const sourceAccess = readOnly ? "Read-only" : "Writable";
	return (
		<>
			<SourceBanner
				sourceAccess={sourceAccess}
				serverDocument={serverDocument}
			/>
			<RemoteAuthControl />
			<IncomeEvidence plan={plan} />
			<AssumptionsPanel plan={plan} onUpdate={onUpdatePlan} />
		</>
	);
}
