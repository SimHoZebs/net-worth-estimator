import type { Movement, Plan } from "./model.ts";

export function purchaseQueue(movements: Movement[]): Movement[] {
	return movements
		.filter((movement) => movement.purchasePriority != null)
		.sort((left, right) => left.purchasePriority! - right.purchasePriority!);
}

export function movePurchase(plan: Plan, id: string, direction: -1 | 1): Plan {
	const queue = purchaseQueue(plan.movements);
	const index = queue.findIndex((movement) => movement.id === id);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= queue.length) return plan;
	[queue[index], queue[nextIndex]] = [queue[nextIndex]!, queue[index]!];
	const priorities = new Map(queue.map((item, rank) => [item.id, rank]));
	return {
		...plan,
		movements: plan.movements.map((movement) =>
			priorities.has(movement.id)
				? { ...movement, purchasePriority: priorities.get(movement.id)! }
				: movement,
		),
	};
}
