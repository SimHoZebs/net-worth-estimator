import { BaseProjectionView } from "../components/BaseProjectionView.tsx";
import { PURCHASE_EVALUATIONS } from "../state/purchaseEvaluation.ts";
import {
	useSavedAccounts,
	useSavedPurchases,
	useSavedStartDate,
} from "../state/savedRows.ts";
import { PlannedPurchasePanel } from "./purchase-planner/PlannedPurchasePanel.tsx";

export function PurchasesPage() {
	const accounts = useSavedAccounts();
	const purchases = useSavedPurchases();
	const startDate = useSavedStartDate();
	if (!accounts || !purchases || !startDate) return null;
	return (
		<BaseProjectionView evaluations={PURCHASE_EVALUATIONS}>
			{({ base, current }) => (
				<PlannedPurchasePanel
					accounts={accounts}
					purchases={purchases}
					startDate={startDate}
					schedule={current ? (base?.plannedPurchases ?? null) : null}
				/>
			)}
		</BaseProjectionView>
	);
}
