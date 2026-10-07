import type { AccountTransaction } from "./accountActivity.ts";
import { isoDate } from "./format.ts";

export interface StatementCycle {
	cycleStart: string;
	cycleEnd: string;
	daysTotal: number;
	daysElapsed: number;
	daysLeft: number;
}

export interface CycleSpendGroup {
	key: string;
	name: string;
	counterparty: string;
	total: number;
	count: number;
}

function utcDate(iso: string): Date {
	return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
	const start = utcDate(startIso).getTime();
	const end = utcDate(endIso).getTime();
	return Math.round((end - start) / 86_400_000) + 1;
}

function monthLength(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function cycleDateFor(
	year: number,
	monthIndex: number,
	statementDay: number,
): string {
	const day = Math.min(statementDay, monthLength(year, monthIndex));
	return isoDate(new Date(Date.UTC(year, monthIndex, day, 12, 0, 0)));
}

/**
 * Resolve the statement cycle containing `todayIso`.
 * statementDay is clamped to 1-28 by the UI so month length never shifts
 * the anchor. The cycle runs from the anchor day to the day before the
 * next anchor, inclusive.
 */
export function resolveStatementCycle({
	todayIso,
	statementDay,
}: {
	todayIso: string;
	statementDay: number;
}): StatementCycle {
	const day = Math.min(28, Math.max(1, Math.floor(statementDay)));
	const today = utcDate(todayIso);
	const year = today.getUTCFullYear();
	const month = today.getUTCMonth();
	const todayDay = today.getUTCDate();

	let startYear = year;
	let startMonth = month;
	if (todayDay < day) {
		startMonth -= 1;
		if (startMonth < 0) {
			startMonth = 11;
			startYear -= 1;
		}
	}
	const cycleStart = cycleDateFor(startYear, startMonth, day);
	let endYear = startYear;
	let endMonth = startMonth + 1;
	if (endMonth > 11) {
		endMonth = 0;
		endYear += 1;
	}
	const nextAnchor = cycleDateFor(endYear, endMonth, day);
	const endDate = utcDate(nextAnchor);
	endDate.setUTCDate(endDate.getUTCDate() - 1);
	const cycleEnd = isoDate(endDate);

	const daysTotal = daysBetweenInclusive(cycleStart, cycleEnd);
	const daysElapsed = daysBetweenInclusive(
		cycleStart,
		todayIso.slice(0, 10) < cycleStart ? cycleStart : todayIso.slice(0, 10),
	);
	const daysLeft = Math.max(
		0,
		daysBetweenInclusive(todayIso.slice(0, 10), cycleEnd),
	);
	return { cycleStart, cycleEnd, daysTotal, daysElapsed, daysLeft };
}

export function isCycleOutflow(transaction: AccountTransaction): boolean {
	return transaction.direction === "out" && !transaction.excluded;
}

/** Spend already incurred in [cycleStart, todayIso]. */
export function cycleSpentSoFar({
	transactions,
	cycleStart,
	todayIso,
}: {
	transactions: AccountTransaction[];
	cycleStart: string;
	todayIso: string;
}): number {
	const today = todayIso.slice(0, 10);
	return transactions
		.filter(
			(transaction) =>
				isCycleOutflow(transaction) &&
				transaction.date >= cycleStart &&
				transaction.date <= today,
		)
		.reduce((sum, transaction) => sum + transaction.amount, 0);
}

/** Scheduled but not yet incurred in (todayIso, cycleEnd]. */
export function cycleScheduledRest({
	transactions,
	cycleEnd,
	todayIso,
}: {
	transactions: AccountTransaction[];
	cycleEnd: string;
	todayIso: string;
}): number {
	const today = todayIso.slice(0, 10);
	return transactions
		.filter(
			(transaction) =>
				isCycleOutflow(transaction) &&
				transaction.date > today &&
				transaction.date <= cycleEnd,
		)
		.reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function groupCycleSpending({
	transactions,
	cycleStart,
	todayIso,
}: {
	transactions: AccountTransaction[];
	cycleStart: string;
	todayIso: string;
}): CycleSpendGroup[] {
	const today = todayIso.slice(0, 10);
	const groups = new Map<string, CycleSpendGroup>();
	for (const transaction of transactions) {
		if (!isCycleOutflow(transaction)) continue;
		if (transaction.date < cycleStart || transaction.date > today) continue;
		const key = `${transaction.name}‖${transaction.counterparty}`;
		const existing = groups.get(key);
		if (existing) {
			existing.total += transaction.amount;
			existing.count += 1;
		} else {
			groups.set(key, {
				key,
				name: transaction.name,
				counterparty: transaction.counterparty,
				total: transaction.amount,
				count: 1,
			});
		}
	}
	return [...groups.values()].sort(
		(a, b) => b.total - a.total || a.key.localeCompare(b.key),
	);
}

export function dailyAllowance({
	budget,
	spent,
	daysLeft,
}: {
	budget: number;
	spent: number;
	daysLeft: number;
}): number {
	if (daysLeft <= 0) return budget - spent;
	return (budget - spent) / daysLeft;
}
