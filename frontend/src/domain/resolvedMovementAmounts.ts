import type { MovementResult } from "./result.ts";

export interface ResolvedMovementAmount {
	amount: number;
	requested: number;
	date: string;
	occurrences: number;
	constrained: boolean;
}

/**
 * Summarize projected occurrences per movement definition.
 *
 * Formula-driven postings (interest = balance * rate, 401(k) = pay * %,
 * payoffs = abs(balance), ...) have no single static amount. The Plan list
 * shows the earliest projected occurrence as the representative figure so
 * the row never dead-ends at "Unavailable".
 */
export function resolveMovementAmounts(
	movements: MovementResult[],
): Map<string, ResolvedMovementAmount> {
	const grouped = new Map<string, MovementResult[]>();
	for (const movement of movements) {
		const group = grouped.get(movement.movementId);
		if (group) group.push(movement);
		else grouped.set(movement.movementId, [movement]);
	}
	const resolved = new Map<string, ResolvedMovementAmount>();
	for (const [movementId, group] of grouped) {
		const ordered = [...group].sort(
			(left, right) =>
				left.date.localeCompare(right.date) || left.requested - right.requested,
		);
		const first = ordered[0];
		if (!first) continue;
		const amount = Number.isFinite(first.realized)
			? first.realized
			: first.requested;
		resolved.set(movementId, {
			amount,
			requested: first.requested,
			date: first.date,
			occurrences: ordered.length,
			constrained: first.requested - first.realized > 0.01,
		});
	}
	return resolved;
}
