import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { exactMoney } from "@/domain/format.ts";

const cents = (value: number): number => Math.round(value * 100) / 100;

export interface PaymentCapacity {
	/** Absolute amount; the word carries direction, never a signed zero. */
	magnitude: number;
	short: boolean;
}

/**
 * Fallback when the exact payment room needs an unknown card payoff. A definite
 * pre-payday gap outranks capacity; otherwise capacity stays informational and
 * never claims the cards can be paid.
 */
export function paymentCapacity(
	summary: SafeSpendingSummary,
): PaymentCapacity | null {
	if (summary.paymentRoom !== null && summary.paymentRoom !== undefined)
		return null;
	if (summary.prePaydayRoom !== null && summary.prePaydayRoom !== undefined) {
		const prePaydayNoReserve = cents(summary.prePaydayRoom + summary.reserve);
		if (prePaydayNoReserve < 0)
			return { magnitude: -prePaydayNoReserve, short: true };
	}
	const capacity = summary.cardPayoffCapacity;
	if (capacity === null || capacity === undefined) return null;
	return capacity < 0
		? { magnitude: cents(-capacity), short: true }
		: { magnitude: cents(capacity), short: false };
}

export const capacityText = (capacity: PaymentCapacity): string =>
	`${exactMoney(capacity.magnitude)} ${capacity.short ? "short before cards" : "for card payoffs"}`;
