import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { PURCHASE_EVALUATIONS } from "../state/purchaseEvaluation.ts";
import { useAccountPlan } from "../state/useAccountScope.ts";
import { WishListPanel } from "./purchase-planner/WishListPanelReplacement.tsx";

export function PurchasesPage() {
	const plan = useAccountPlan();
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
