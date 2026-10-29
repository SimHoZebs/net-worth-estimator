import type { PlannedPurchase, Plan } from "./model.ts";

/**
 * The purchase queue is the display plan's `plannedPurchases` slice in
 * order. Array order is the priority: earlier buys first, a blocked item
 * holds the rest of the queue. The backend derives the same priority from
 * row position.
 */
export function purchaseQueue(planned: PlannedPurchase[]): PlannedPurchase[] {
	return [...planned];
}

export function movePurchase(plan: Plan, id: string, direction: -1 | 1): Plan {
	const queue = [...plan.plannedPurchases];
	const index = queue.findIndex((purchase) => purchase.id === id);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= queue.length) return plan;
	[queue[index], queue[nextIndex]] = [queue[nextIndex]!, queue[index]!];
	return {
		...plan,
		plannedPurchases: queue,
	};
}
