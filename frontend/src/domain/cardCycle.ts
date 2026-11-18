import type { AccountTransaction } from "./accountActivity.ts";
import {
	clampMonth,
	daysBetweenInclusive,
	isoDate,
	shiftDate,
	utcDate,
} from "./format.ts";
import { DEFAULT_CYCLE_STATEMENT_DAY } from "./safeSpending.ts";

export interface StatementCycle {
	cycleStart: string;
	cycleEnd: string;
	daysTotal: number;
	daysElapsed: number;
	daysLeft: number;
}

/** Statement day is pinned to 1-28 so month length never shifts the anchor. */
export function clampStatementDay(value: unknown): number {
	return Math.min(
		28,
		Math.max(1, Math.floor(Number(value) || DEFAULT_CYCLE_STATEMENT_DAY)),
	);
}

/**
 * Resolve the statement cycle containing `todayIso`.
 * The cycle runs from the anchor day to the day before the next anchor,
 * inclusive.
 */
export function resolveStatementCycle({
	todayIso,
	statementDay,
}: {
	todayIso: string;
	statementDay: number;
}): StatementCycle {
	const day = clampStatementDay(statementDay);
	const today = utcDate(todayIso);
	const year = today.getUTCFullYear();
	const month = today.getUTCMonth();
	const todayDay = todayIso.slice(0, 10);

	let startYear = year;
	let startMonth = month;
	if (today.getUTCDate() < day) {
		startMonth -= 1;
		if (startMonth < 0) {
			startMonth = 11;
			startYear -= 1;
		}
	}
	const cycleStart = clampMonth({ year: startYear, month: startMonth, day });
	let endYear = startYear;
	let endMonth = startMonth + 1;
	if (endMonth > 11) {
		endMonth = 0;
		endYear += 1;
	}
	const nextAnchor = clampMonth({ year: endYear, month: endMonth, day });
	const endDate = utcDate(nextAnchor);
	endDate.setUTCDate(endDate.getUTCDate() - 1);
	const cycleEnd = isoDate(endDate);

	const elapsedEnd = todayDay < cycleStart ? cycleStart : todayDay;
	return {
		cycleStart,
		cycleEnd,
		daysTotal: daysBetweenInclusive(cycleStart, cycleEnd),
		daysElapsed: daysBetweenInclusive(cycleStart, elapsedEnd),
		daysLeft: Math.max(0, daysBetweenInclusive(todayDay, cycleEnd)),
	};
}

export function isCycleOutflow(transaction: AccountTransaction): boolean {
	// Pending charges commit spending even while disabled for projections.
	// Void holds never settled, so they never count as spending.
	return (
		!transaction.void &&
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

/**
 * Resolve the statement cycle at an offset from the cycle containing
 * `todayIso`. Offset 0 is the containing cycle; negative steps move to
 * earlier cycles by resolving the day before the current start, positive
 * steps move to later cycles by resolving the day after the current end.
 */
export function resolveStatementCycleAtOffset({
	todayIso,
	statementDay,
	offset,
}: {
	todayIso: string;
	statementDay: number;
	offset: number;
}): StatementCycle {
	let cycle = resolveStatementCycle({ todayIso, statementDay });
	if (offset < 0) {
		for (let step = 0; step < -offset; step += 1) {
			cycle = resolveStatementCycle({
				todayIso: shiftDate({ date: cycle.cycleStart, days: -1 }),
				statementDay,
			});
		}
	} else if (offset > 0) {
		for (let step = 0; step < offset; step += 1) {
			cycle = resolveStatementCycle({
				todayIso: shiftDate({ date: cycle.cycleEnd, days: 1 }),
				statementDay,
			});
		}
	}
	return cycle;
}
