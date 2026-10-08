import type { Plan } from "./model.ts";
import type { MovementResult } from "./result.ts";

export const DEFAULT_CYCLE_STATEMENT_DAY = 20;
export const DEFAULT_PROTECTED_RESERVE = 725;

function utcDate(iso: string): Date {
	return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}

function toIso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Last calendar day of the month containing `todayIso`. */
export function monthEndIso(todayIso: string): string {
	const today = utcDate(todayIso);
	const end = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12, 0, 0),
	);
	return toIso(end);
}

/** Inclusive [start, end] of the calendar month after `todayIso`. */
export function nextMonthRange(todayIso: string): {
	start: string;
	end: string;
} {
	const today = utcDate(todayIso);
	const start = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1, 12, 0, 0),
	);
	const end = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0, 12, 0, 0),
	);
	return { start: toIso(start), end: toIso(end) };
}

export function checkingAccountId(plan: Plan): string | null {
	const byId = plan.accounts.find((account) => account.id === "checking");
	if (byId) return byId.id;
	const cash = plan.accounts.find(
		(account) => account.kind === "cash" && account.enabled,
	);
	if (cash) return cash.id;
	const anyCash = plan.accounts.find((account) => account.kind === "cash");
	return anyCash?.id ?? null;
}

export function checkingBalance(plan: Plan): number | null {
	const id = checkingAccountId(plan);
	if (!id) return null;
	return plan.accounts.find((account) => account.id === id)?.balance ?? null;
}

/**
 * Remaining unpaid monthly obligations: requested checking outflows dated
 * after today through the end of the current calendar month.
 */
export function remainingMonthlyObligations({
	movements,
	checkingId,
	todayIso,
}: {
	movements: MovementResult[];
	checkingId: string;
	todayIso: string;
}): { total: number; monthEnd: string } {
	const today = todayIso.slice(0, 10);
	const monthEnd = monthEndIso(today);
	const total = movements
		.filter(
			(movement) =>
				movement.fromId === checkingId &&
				movement.date > today &&
				movement.date <= monthEnd &&
				movement.requested > 0,
		)
		.reduce((sum, movement) => sum + movement.requested, 0);
	return { total, monthEnd };
}

/** Next calendar month's fixed obligations from checking. */
export function nextMonthObligations({
	movements,
	checkingId,
	todayIso,
}: {
	movements: MovementResult[];
	checkingId: string;
	todayIso: string;
}): { total: number; start: string; end: string } {
	const { start, end } = nextMonthRange(todayIso);
	const total = movements
		.filter(
			(movement) =>
				movement.fromId === checkingId &&
				movement.date >= start &&
				movement.date <= end &&
				movement.requested > 0,
		)
		.reduce((sum, movement) => sum + movement.requested, 0);
	return { total, start, end };
}

/**
 * Expected next paycheck: total external inflow into checking on the earliest
 * date after today. Null when no upcoming inflow is projected.
 */
export function nextPaycheck({
	movements,
	checkingId,
	todayIso,
}: {
	movements: MovementResult[];
	checkingId: string;
	todayIso: string;
}): { date: string; amount: number } | null {
	const today = todayIso.slice(0, 10);
	const upcoming = movements.filter(
		(movement) =>
			movement.toId === checkingId &&
			!movement.fromId &&
			movement.date > today &&
			movement.requested > 0,
	);
	if (!upcoming.length) return null;
	const earliest = upcoming.reduce(
		(first, movement) => (movement.date < first ? movement.date : first),
		upcoming[0]!.date,
	);
	const amount = upcoming
		.filter((movement) => movement.date === earliest)
		.reduce((sum, movement) => sum + movement.requested, 0);
	return { date: earliest, amount };
}

/**
 * Cash cushion: checking balance minus remaining unpaid monthly obligations.
 * Card purchases do not reduce the cushion here; they are budgeted against
 * the next paycheck in the cycle allowance.
 */
export function cashCushion({
	checking,
	remainingObligations,
}: {
	checking: number;
	remainingObligations: number;
}): number {
	return checking - remainingObligations;
}

/** Amount set aside for the card cycle before spending. */
export function cycleBudget({
	paycheck,
	fixedObligations,
	reserve,
}: {
	paycheck: number;
	fixedObligations: number;
	reserve: number;
}): number {
	return paycheck - fixedObligations - reserve;
}

/**
 * Credit-card cycle allowance: expected next paycheck minus next month's
 * fixed obligations, spending already committed this cycle, and the
 * protected reserve. Independent of the current checking balance.
 */
export function cycleAllowance({
	paycheck,
	fixedObligations,
	spent,
	reserve,
}: {
	paycheck: number;
	fixedObligations: number;
	spent: number;
	reserve: number;
}): number {
	return paycheck - fixedObligations - spent - reserve;
}
