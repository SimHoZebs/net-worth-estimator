import type { AccountTransaction } from "./accountActivity.ts";
import { isCycleOutflow } from "./cardCycle.ts";
import { daysBetweenInclusive, shiftDate } from "./format.ts";

export interface SafeSpendingTrendPoint {
	date: string;
	spent: number;
	projected: boolean;
}

export interface SafeSpendingThresholdHit {
	date: string;
	amount: number;
	projected: boolean;
}

export interface SafeSpendingTrend {
	actual: SafeSpendingTrendPoint[];
	projected: SafeSpendingTrendPoint[];
	limit: number;
	safetyNet: number;
	averageDaily: number;
	limitHit: SafeSpendingThresholdHit | null;
	safetyNetHit: SafeSpendingThresholdHit | null;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

function firstHit(
	points: readonly SafeSpendingTrendPoint[],
	threshold: number,
): SafeSpendingThresholdHit | null {
	if (!Number.isFinite(threshold)) return null;
	for (const point of points) {
		// A negative threshold is already exceeded at zero spending. The
		// first real charge is the first row a divider can follow.
		if (point.spent <= 0 && threshold < 0) continue;
		if (point.spent > threshold) {
			return {
				date: point.date,
				amount: point.spent,
				projected: point.projected,
			};
		}
	}
	return null;
}

/**
 * Daily cumulative card spending for one statement cycle. Actual rows run
 * from the cycle start through today; projected rows continue from today at
 * the average daily rate. Threshold hits mark the first day cumulative
 * spending passes each amount, so the same dates drive the list dividers and
 * the pace chart.
 */
export function safeSpendingTrend({
	transactions,
	cycleStart,
	cycleEnd,
	todayIso,
	limit,
	safetyNet,
}: {
	transactions: readonly AccountTransaction[];
	cycleStart: string;
	cycleEnd: string;
	todayIso: string;
	limit: number;
	safetyNet: number;
}): SafeSpendingTrend {
	const start = cycleStart.slice(0, 10);
	const end = cycleEnd.slice(0, 10);
	const rawToday = todayIso.slice(0, 10);
	const today = rawToday < start ? start : rawToday > end ? end : rawToday;
	const empty = {
		actual: [],
		projected: [],
		limit,
		safetyNet,
		averageDaily: 0,
		limitHit: null,
		safetyNetHit: null,
	};
	if (end < start) return empty;

	const daily = new Map<string, number>();
	for (const transaction of transactions) {
		if (!isCycleOutflow(transaction) || transaction.amount <= 0) continue;
		const date = transaction.date.slice(0, 10);
		if (date < start || date > today) continue;
		daily.set(date, (daily.get(date) ?? 0) + transaction.amount);
	}

	const actual: SafeSpendingTrendPoint[] = [];
	let cumulative = 0;
	const elapsedDays = daysBetweenInclusive(start, today);
	for (let offset = 0; offset < elapsedDays; offset++) {
		const date = shiftDate({ date: start, days: offset });
		cumulative = roundCents(cumulative + (daily.get(date) ?? 0));
		actual.push({ date, spent: cumulative, projected: false });
	}

	const averageDaily =
		actual.length > 0 ? roundCents(cumulative / actual.length) : 0;
	const remainingDays = Math.max(0, daysBetweenInclusive(today, end) - 1);
	const projected: SafeSpendingTrendPoint[] = [];
	if (remainingDays > 0 && averageDaily > 0) {
		projected.push({ date: today, spent: cumulative, projected: true });
		for (let offset = 1; offset <= remainingDays; offset++) {
			projected.push({
				date: shiftDate({ date: today, days: offset }),
				spent: roundCents(cumulative + averageDaily * offset),
				projected: true,
			});
		}
	}

	return {
		actual,
		projected,
		limit,
		safetyNet,
		averageDaily,
		limitHit: firstHit(actual, limit) ?? firstHit(projected, limit),
		safetyNetHit: firstHit(actual, safetyNet) ?? firstHit(projected, safetyNet),
	};
}
