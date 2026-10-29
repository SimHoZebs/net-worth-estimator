import type { PlannedPurchase } from "../../../domain/model.ts";

/** No additional scheduling rules are inferred from startDate. */
export type PurchaseTiming =
	| { kind: "flexible"; earliestDate: string }
	| { kind: "fixed"; requiredDate: string };

/** These are UI facts, not rules computed in React. The engine is authoritative. */
export type PurchaseOutcome =
	| { kind: "scheduled"; date: string }
	| {
			kind: "not-scheduled";
			reason?: "outside-horizon" | "priority-blocked" | "unknown";
			blockedById?: string;
	  }
	| {
			kind: "fixed-conflict";
			date: string;
			shortfall?: number;
			available?: number;
			explanation?: string;
	  }
	| { kind: "pending" }
	| { kind: "excluded" };

export interface PurchaseViewItem {
	purchase: PlannedPurchase;
	priority: number;
	accountName: string;
	timing: PurchaseTiming;
	outcome: PurchaseOutcome;
}

/** Optional future engine response. Do NOT fabricate fixed conflicts using a null legacy date. */
export interface PurchaseEnhancement {
	timing?: PurchaseTiming;
	outcome?: PurchaseOutcome;
}

export type PurchaseEnhancements = Readonly<
	Record<string, PurchaseEnhancement>
>;

export interface PurchasePlannerActions {
	onAdd?: () => void;
	onEdit?: (purchase: PlannedPurchase) => void;
	onRemove?: (purchase: PlannedPurchase) => void;
	onMove?: (purchase: PlannedPurchase, direction: -1 | 1) => void;
}
