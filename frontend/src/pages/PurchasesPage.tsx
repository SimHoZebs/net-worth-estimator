import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { PURCHASE_EVALUATIONS } from "../state/purchaseEvaluation.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { WishListPanel } from "./plan/WishListPanel.tsx";

export function PurchasesPage() {
	const plan = useWorkspaceStore(
		(state) => state.workspace?.draft ?? state.workspace?.saved ?? null,
	);
	if (!plan) return null;
	return (
		<BaseProjectionView evaluations={PURCHASE_EVALUATIONS}>
			{({ base, current }) => (
				<WishListPanel
					plan={plan}
					schedule={current ? (base?.plannedPurchases ?? null) : null}
				/>
			)}
		</BaseProjectionView>
	);
}
