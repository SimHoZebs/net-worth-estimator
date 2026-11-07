import type { PlannedPurchase } from "./model.ts";

/**
 * Reorder one wishlist row, returning the new queue order. The input is
 * never mutated. Returns the input unchanged when the move is a no-op
 * (edges of the queue, unknown id).
 */
export function movePurchase(
	purchases: PlannedPurchase[],
	id: string,
	direction: -1 | 1,
): PlannedPurchase[] {
	const index = purchases.findIndex((purchase) => purchase.id === id);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= purchases.length)
		return purchases;
	const next = [...purchases];
	[next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
	return next;
}
