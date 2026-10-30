import type { PlannedPurchase } from "../../domain/model.ts";

/** The earliest date the engine may schedule the purchase. */
export type PurchaseTiming = {
	earliestDate: string;
};

/** These are UI facts, not rules computed in React. The engine is authoritative. */
export type PurchaseOutcome =
	| { kind: "scheduled"; date: string }
	| { kind: "not-scheduled" }
	| { kind: "pending" }
	| { kind: "excluded" };

export interface PurchaseViewItem {
	purchase: PlannedPurchase;
	priority: number;
	accountName: string;
	timing: PurchaseTiming;
	outcome: PurchaseOutcome;
}

export interface PurchasePlannerActions {
	onAdd?: () => void;
	onEdit?: (purchase: PlannedPurchase) => void;
	onRemove?: (purchase: PlannedPurchase) => void;
	onMove?: (purchase: PlannedPurchase, direction: -1 | 1) => void;
}
