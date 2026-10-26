import type { MovementResult } from "./result.ts";

export interface ProjectedPayment {
	date: string;
	amount: number;
}

/**
 * Earliest server-projected requested payment per rule after today, summed
 * across same-day fragments. Shared by income sources and bill candidates so
 * both lists describe the same upcoming occurrence.
 */
export function nextProjectedPayments({
	movements,
	rules,
	todayIso,
}: {
	movements: MovementResult[];
	rules: { id: string; endDate: string | null }[];
	todayIso: string;
}): Map<string, ProjectedPayment> {
	const today = todayIso.slice(0, 10);
	const known = new Map(rules.map((rule) => [rule.id, rule]));
	const next = new Map<string, ProjectedPayment>();
	for (const movement of movements) {
		const rule = known.get(movement.movementId);
		if (!rule || movement.date <= today || movement.requested <= 0) continue;
		if (rule.endDate !== null && movement.date > rule.endDate) continue;
		const previous = next.get(rule.id);
		if (!previous || movement.date < previous.date) {
			next.set(rule.id, {
				date: movement.date,
				amount: movement.requested,
			});
		} else if (movement.date === previous.date) {
			previous.amount += movement.requested;
		}
	}
	return next;
}
