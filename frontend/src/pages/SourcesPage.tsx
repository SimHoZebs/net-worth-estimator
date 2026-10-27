import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { usePlan, useWorkspaceReadOnly } from "../state/useWorkspacePlan.ts";
import { useServerModel } from "../state/workspaceResources.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { SyncSettings } from "./sources/SyncSettings.tsx";

export function SourcesPage() {
	// Everything subscribes here, including the access control.
	const plan = usePlan();
	const serverDocument = useServerModel().data?.document;
	const readOnly = useWorkspaceReadOnly();
	const onUpdatePlan = useWorkspaceStore((state) => state.updatePlan);
	if (!plan) return null;
	return (
		<>
			<SyncSettings
				accounts={plan.accounts.map((account) => ({
					id: account.id,
					name: account.name,
					kind: account.kind,
					color: account.color,
				}))}
				readOnly={readOnly}
			/>
			<AmountCatalog
				accounts={plan.accounts.map((account) => ({
					id: account.id,
					name: account.name,
				}))}
				postings={[
					...(serverDocument?.recurrenceRules ?? []).map((rule) => ({
						id: rule.id,
						name: rule.name,
					})),
					...(serverDocument?.postings ?? []).map((posting) => ({
						id: posting.id,
						name: posting.name,
					})),
				]}
			/>
			<AssumptionsPanel plan={plan} onUpdate={onUpdatePlan} />
		</>
	);
}
