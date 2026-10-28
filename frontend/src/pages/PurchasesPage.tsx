import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { PURCHASE_EVALUATIONS } from "../state/purchaseEvaluation.ts";
import { usePlan } from "../state/useWorkspacePlan.ts";
import { WishListPanel } from "./plan/purchase-planner/WishListPanelReplacement.tsx";

export function PurchasesPage() {
	const plan = usePlan();
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
