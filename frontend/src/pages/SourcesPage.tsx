import { AmountCatalog } from "../components/editors/AmountCatalog.tsx";
import {
	selectIsReadOnly,
	selectPlan,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { AssumptionsPanel } from "./plan/AssumptionsPanel.tsx";
import { SourceBanner } from "./sources/SourceHealth.tsx";

export function SourcesPage() {
	// Everything subscribes here, including the access control.
	const plan = useWorkspaceStore(selectPlan);
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const readOnly = useWorkspaceStore(selectIsReadOnly);
	const onUpdatePlan = useWorkspaceStore((state) => state.updatePlan);
	if (!plan) return null;
	const sourceAccess = readOnly ? "Read-only" : "Writable";
	return (
		<>
			<SourceBanner sourceAccess={sourceAccess} />
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
