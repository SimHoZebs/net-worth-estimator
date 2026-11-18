import type { AccountTransaction } from "./accountActivity.ts";
import { isCycleOutflow } from "./cardCycle.ts";
import { daysBetweenInclusive, shiftDate } from "./format.ts";
import { sortTransactionsByDate } from "./transactionSort.ts";
import type { RecurringBillIncrease } from "./recurringBillIncreases.ts";
import {
	groupByDate,
	hasUnknownSpending,
	inWindow,
	occurrenceKey,
	roundCents,
	sumCents,
} from "./safeSpendingMath.ts";

export type SafeSpendingScheduledIncrease = RecurringBillIncrease;

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
	scheduledIncreases: SafeSpendingScheduledIncrease[];
	/** Every selected bill occurrence, including those already in actual spending. */
	billMarkers: SafeSpendingScheduledIncrease[];
}

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
					inWindow(row.date, cycleStart, cycleEnd) &&
					row.date <= todayIso,
			)
			.filter((row) => {
				// Account selections can overlap. Count the same recorded financial
				// effect once, without merging distinct split effects or saved IDs.
				const identity = JSON.stringify([
					occurrenceKey(row.transactionId, row.date),
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

/** Recurring increases due from today through cycle end, one row per day.
 * Names of same-day bills collect in stable first-seen order. */
function scheduledIncreasesFor(
	outflows: readonly SafeSpendingScheduledIncrease[],
	today: string,
	end: string,
): SafeSpendingScheduledIncrease[] {
	return groupByDate(
		outflows.filter(
			(increase) =>
				inWindow(increase.date, today, end) &&
				Number.isFinite(increase.amount) &&
				increase.amount > 0,
		),
		(increase) => increase.amount,
		(increase) => increase.name,
	);
}

/** Cumulative recorded spending for each elapsed day of the cycle. */
function actualSeries({
	ledger,
	start,
	today,
}: {
	ledger: readonly AccountTransaction[];
	start: string;
	today: string;
}): SafeSpendingTrendPoint[] {
	const rowsByDay = new Map<string, AccountTransaction[]>();
	for (const row of ledger) {
		if (!inWindow(row.date, start, today)) continue;
		const day = row.date.slice(0, 10);
		const rows = rowsByDay.get(day) ?? [];
		rows.push(row);
		rowsByDay.set(day, rows);
	}

	const points: SafeSpendingTrendPoint[] = [];
	let cumulative = 0;
	const elapsedDays = daysBetweenInclusive(start, today);
	for (let offset = 0; offset < elapsedDays; offset++) {
		const date = shiftDate({ date: start, days: offset });
		const rows = rowsByDay.get(date);
		cumulative = roundCents(
			cumulative + (rows ? sumCents(rows, spendingAmount) : 0),
		);
		points.push({ date, spent: cumulative, projected: false });
	}
	return points;
}

/** Average daily rate plus scheduled increases for the remaining cycle. */
function projectedSeries({
	cumulative,
	averageDaily,
	today,
	end,
	increases,
}: {
	cumulative: number;
	averageDaily: number;
	today: string;
	end: string;
	increases: readonly SafeSpendingScheduledIncrease[];
}): SafeSpendingTrendPoint[] {
	const remainingDays = Math.max(0, daysBetweenInclusive(today, end) - 1);
	if (remainingDays <= 0 || (averageDaily <= 0 && increases.length === 0))
		return [];

	const increaseCentsByDate = new Map(
		increases.map((increase) => [
			increase.date.slice(0, 10),
			Math.round(increase.amount * 100),
		]),
	);
	const todaysIncreaseCents = increaseCentsByDate.get(today) ?? 0;
	const projected: SafeSpendingTrendPoint[] = [];
	if (todaysIncreaseCents > 0) {
		projected.push({
			date: today,
			spent: roundCents(cumulative),
			projected: true,
		});
	}
	let increaseCents = todaysIncreaseCents;
	projected.push({
		date: today,
		spent: roundCents(cumulative + increaseCents / 100),
		projected: true,
	});
	for (let offset = 1; offset <= remainingDays; offset++) {
		const date = shiftDate({ date: today, days: offset });
		increaseCents += increaseCentsByDate.get(date) ?? 0;
		projected.push({
			date,
			spent: roundCents(
				cumulative + averageDaily * offset + increaseCents / 100,
			),
			projected: true,
		});
	}
	return projected;
}

/**
 * Daily cumulative spending for one statement cycle. Actual rows run
 * from the cycle start through today; projected rows continue from today at
 * the average daily rate plus scheduled increases for recurring bills due
 * today or later in the cycle.
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
	billMarkers = [],
}: {
	transactions: readonly AccountTransaction[];
	cycleStart: string;
	cycleEnd: string;
	todayIso: string;
	limit: number | null;
	safetyNet: number | null;
	scheduledOutflows?: readonly SafeSpendingScheduledIncrease[];
	billMarkers?: SafeSpendingScheduledIncrease[];
}): SafeSpendingTrend {
	const start = cycleStart.slice(0, 10);
	const end = cycleEnd.slice(0, 10);
	const rawToday = todayIso.slice(0, 10);
	const today = rawToday < start ? start : rawToday > end ? end : rawToday;
	const scheduledIncreases = scheduledIncreasesFor(
		scheduledOutflows,
		today,
		end,
	);
	const empty: SafeSpendingTrend = {
		actual: [],
		projected: [],
		limit,
		safetyNet,
		averageDaily: 0,
		limitHit: null,
		safetyNetHit: null,
		scheduledIncreases,
		billMarkers,
	};
	if (end < start) return { ...empty, scheduledIncreases: [], billMarkers };

	const ledger = spendingLedger({
		transactions,
		cycleStart: start,
		cycleEnd: end,
		todayIso: today,
	});
	if (hasUnknownSpending(ledger)) {
		return { ...empty, spendingAvailable: false, limit: null, safetyNet: null };
	}

	const actual = actualSeries({ ledger, start, today });
	const cumulative = actual.at(-1)?.spent ?? 0;
	const averageDaily =
		actual.length > 0 ? roundCents(cumulative / actual.length) : 0;
	const projected = projectedSeries({
		cumulative,
		averageDaily,
		today,
		end,
		increases: scheduledIncreases,
	});

	return {
		actual,
		projected,
		limit,
		safetyNet,
		averageDaily,
		limitHit: ledgerHit(ledger, limit) ?? firstHit(projected, limit),
		safetyNetHit:
			ledgerHit(ledger, safetyNet) ?? firstHit(projected, safetyNet),
		scheduledIncreases,
		billMarkers,
	};
}
