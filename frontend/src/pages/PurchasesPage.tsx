import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { PURCHASE_EVALUATIONS } from "../state/purchaseEvaluation.ts";
import { useUserPlan } from "../state/useUserScope.ts";
import { WishListPanel } from "./purchase-planner/WishListPanelReplacement.tsx";

export function PurchasesPage() {
	const plan = useUserPlan();
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
