import type { AccountTransaction } from "./accountActivity.ts";
import {
	clampMonth,
	daysBetweenInclusive,
	isoDate,
	utcDate,
} from "./format.ts";

export interface StatementCycle {
	cycleStart: string;
	cycleEnd: string;
	daysTotal: number;
	daysElapsed: number;
	daysLeft: number;
}

function cycleDateFor(
	year: number,
	monthIndex: number,
	statementDay: number,
): string {
	return clampMonth({ year, month: monthIndex, day: statementDay });
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
	// Pending charges commit spending even while disabled for projections.
	return (
		transaction.direction === "out" &&
		(!transaction.excluded || transaction.pending)
	);
}

/** Included card outflows in the inclusive [cycleStart, todayIso] window. */
export function cycleOutflowTransactions({
	transactions,
	cycleStart,
	todayIso,
}: {
	transactions: AccountTransaction[];
	cycleStart: string;
	todayIso: string;
}): AccountTransaction[] {
	const today = todayIso.slice(0, 10);
	return transactions.filter(
		(transaction) =>
			isCycleOutflow(transaction) &&
			transaction.date >= cycleStart &&
			transaction.date <= today,
	);
}

/** Spend already incurred in [cycleStart, todayIso]. */
export function cycleSpentSoFar(input: {
	transactions: AccountTransaction[];
	cycleStart: string;
	todayIso: string;
}): number {
	return cycleOutflowTransactions(input).reduce(
		(sum, transaction) => sum + transaction.amount,
		0,
	);
}
