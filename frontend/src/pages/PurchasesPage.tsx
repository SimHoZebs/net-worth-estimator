import { PlannedPurchasePanel } from "./purchase-planner/PlannedPurchasePanel.tsx";

export function PurchasesPage() {
	// The panel subscribes to its own saved rows and projection.
	return <PlannedPurchasePanel />;
}
