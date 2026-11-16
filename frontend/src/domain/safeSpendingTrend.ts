import type { AccountTransaction } from "./accountActivity.ts";
import { isCycleOutflow } from "./cardCycle.ts";
import { daysBetweenInclusive, shiftDate } from "./format.ts";
import { sortTransactionsByDate } from "./transactionSort.ts";
import type { CardScheduledBump } from "./cardScheduledOutflows.ts";

export type SafeSpendingScheduledBump = CardScheduledBump;

export interface SafeSpendingTrendPoint {
	date: string;
	spent: number;
	projected: boolean;
}

export interface SafeSpendingThresholdHit {
	transactionId?: string;
	date: string;
	amount: number;
	projected: boolean;
}

export interface SafeSpendingTrend {
	spendingAvailable?: boolean;
	monthlyIncome?: {
		amount: number;
		spent: number | null;
		coordinate: number | null;
		start: string;
		end: string;
		hit: SafeSpendingThresholdHit | null;
	};
	actual: SafeSpendingTrendPoint[];
	projected: SafeSpendingTrendPoint[];
	limit: number | null;
	safetyNet: number | null;
	averageDaily: number;
	limitHit: SafeSpendingThresholdHit | null;
	safetyNetHit: SafeSpendingThresholdHit | null;
	scheduledBumps: SafeSpendingScheduledBump[];
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

export const spendingAmount = (row: AccountTransaction): number =>
	row.spendingAmount ?? row.amount;

function firstHit(
	points: readonly SafeSpendingTrendPoint[],
	threshold: number | null,
): SafeSpendingThresholdHit | null {
	if (threshold === null || !Number.isFinite(threshold)) return null;
	for (const point of points) {
		if (threshold < 0) return null;
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

/** Recorded spending only, in stable chronology shared by totals and crossings. */
export function spendingLedger({
	transactions,
	cycleStart,
	cycleEnd,
	todayIso,
}: {
	transactions: readonly AccountTransaction[];
	cycleStart: string;
	cycleEnd: string;
	todayIso: string;
}): AccountTransaction[] {
	const seen = new Set<string>();
	return sortTransactionsByDate({
		items: transactions
			.filter(
				(row) =>
					row.source === "historical" &&
					(row.direction === "out"
						? isCycleOutflow(row)
						: row.spendingAmount !== undefined && !row.excluded && !row.void) &&
					row.flow !== "transfer" &&
					(spendingAmount(row) !== 0 || row.spendingAmountUnknown === true) &&
					row.date >= cycleStart &&
					row.date <= cycleEnd &&
					row.date <= todayIso,
			)
			.filter((row) => {
				// Account selections can overlap. Count the same recorded financial
				// effect once, without merging distinct split effects or saved IDs.
				const identity = JSON.stringify([
					row.transactionId,
					row.date,
					row.direction,
					row.flow,
					row.from,
					row.to,
					row.amount,
				]);
				if (seen.has(identity)) return false;
				seen.add(identity);
				return true;
			}),
		getDate: (row) => row.sortDate ?? row.date,
		getId: (row) => row.id,
		order: "oldest",
	});
}

export function ledgerHit(
	ledger: readonly AccountTransaction[],
	threshold: number | null,
): SafeSpendingThresholdHit | null {
	if (threshold === null || !Number.isFinite(threshold) || threshold < 0)
		return null;
	let spentCents = 0;
	for (const row of ledger) {
		const before = spentCents;
		spentCents += Math.round(spendingAmount(row) * 100);
		const thresholdCents = Math.round(threshold * 100);
		if (before <= thresholdCents && spentCents > thresholdCents) {
			return {
				date: row.date,
				amount: spentCents / 100,
				projected: false,
				transactionId: row.id,
			};
		}
	}
	return null;
}

/**
 * Daily cumulative spending for one statement cycle. Actual rows run
 * from the cycle start through today; projected rows continue from today at
 * the average daily rate plus discrete steps for known future card charges.
 * Actual crossings retain the exact ledger row identity,
 * even when several charges share a day. Negative opening capacity has no causal row.
 */
export function safeSpendingTrend({
	transactions,
	cycleStart,
	cycleEnd,
	todayIso,
	limit,
	safetyNet,
	scheduledOutflows = [],
}: {
	transactions: readonly AccountTransaction[];
	cycleStart: string;
	cycleEnd: string;
	todayIso: string;
	limit: number | null;
	safetyNet: number | null;
	scheduledOutflows?: readonly SafeSpendingScheduledBump[];
}): SafeSpendingTrend {
	const start = cycleStart.slice(0, 10);
	const end = cycleEnd.slice(0, 10);
	const rawToday = todayIso.slice(0, 10);
	const today = rawToday < start ? start : rawToday > end ? end : rawToday;
	const grouped = new Map<string, { cents: number; names: string[] }>();
	for (const bump of scheduledOutflows) {
		const day = bump.date.slice(0, 10);
		if (day <= today || day > end) continue;
		if (!Number.isFinite(bump.amount) || bump.amount <= 0) continue;
		const entry = grouped.get(day) ?? { cents: 0, names: [] as string[] };
		entry.cents += Math.round(bump.amount * 100);
		if (bump.name && !entry.names.includes(bump.name))
			entry.names.push(bump.name);
		grouped.set(day, entry);
	}
	const scheduledBumps: SafeSpendingScheduledBump[] = [...grouped.entries()]
		.map(([date, entry]) => ({
			date,
			amount: roundCents(entry.cents / 100),
			...(entry.names.length ? { name: entry.names.join(", ") } : {}),
		}))
		.sort((left, right) => (left.date < right.date ? -1 : 1));
	const empty: SafeSpendingTrend = {
		actual: [],
		projected: [],
		limit,
		safetyNet,
		averageDaily: 0,
		limitHit: null,
		safetyNetHit: null,
		scheduledBumps,
	};
	if (end < start) return { ...empty, scheduledBumps: [] };

	const daily = new Map<string, number>();
	const ledger = spendingLedger({
		transactions,
		cycleStart: start,
		cycleEnd: end,
		todayIso: today,
	});
	if (ledger.some((row) => row.spendingAmountUnknown)) {
		return { ...empty, spendingAvailable: false, limit: null, safetyNet: null };
	}
	for (const transaction of ledger) {
		const date = transaction.date.slice(0, 10);
		if (date < start || date > today) continue;
		daily.set(
			date,
			(daily.get(date) ?? 0) + Math.round(spendingAmount(transaction) * 100),
		);
	}

	const actual: SafeSpendingTrendPoint[] = [];
	let cumulative = 0;
	const elapsedDays = daysBetweenInclusive(start, today);
	for (let offset = 0; offset < elapsedDays; offset++) {
		const date = shiftDate({ date: start, days: offset });
		cumulative = roundCents(cumulative + (daily.get(date) ?? 0) / 100);
		actual.push({ date, spent: cumulative, projected: false });
	}

	const averageDaily =
		actual.length > 0 ? roundCents(cumulative / actual.length) : 0;
	const remainingDays = Math.max(0, daysBetweenInclusive(today, end) - 1);
	const projected: SafeSpendingTrendPoint[] = [];
	if (remainingDays > 0 && (averageDaily > 0 || scheduledBumps.length > 0)) {
		const bumpCentsByDate = new Map(
			scheduledBumps.map((bump) => [bump.date, Math.round(bump.amount * 100)]),
		);
		let bumpCents = 0;
		projected.push({ date: today, spent: cumulative, projected: true });
		for (let offset = 1; offset <= remainingDays; offset++) {
			const date = shiftDate({ date: today, days: offset });
			bumpCents += bumpCentsByDate.get(date) ?? 0;
			projected.push({
				date,
				spent: roundCents(cumulative + averageDaily * offset + bumpCents / 100),
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
		limitHit: ledgerHit(ledger, limit) ?? firstHit(projected, limit),
		safetyNetHit:
			ledgerHit(ledger, safetyNet) ?? firstHit(projected, safetyNet),
		scheduledBumps,
	};
}
