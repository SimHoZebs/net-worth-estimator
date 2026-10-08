import { isoDate } from "./format.ts";
import type { Plan } from "./model.ts";
import type { MovementResult } from "./result.ts";

export const DEFAULT_CYCLE_STATEMENT_DAY = 20;
export const DEFAULT_PROTECTED_RESERVE = 725;
/**
 * Virtual account staging gross pay before payroll splits. Take-home pay
 * arrives in checking as a transfer from here, so it counts as a paycheck
 * alongside external inflows.
 */
export const VIRTUAL_PAY_ACCOUNT_ID = "gross_pay";

function utcDate(iso: string): Date {
	return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}

/** Last calendar day of the month containing `todayIso`. */
export function monthEndIso(todayIso: string): string {
	const today = utcDate(todayIso);
	const end = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 12, 0, 0),
	);
	return isoDate(end);
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
	return { start: isoDate(start), end: isoDate(end) };
}

export function checkingAccountId(plan: Plan): string | null {
	const visible = plan.accounts.filter((account) => !account.archived);
	const byId = visible.find((account) => account.id === "checking");
	if (byId) return byId.id;
	const cash = visible.find(
		(account) => account.kind === "cash" && account.enabled,
	);
	if (cash) return cash.id;
	const anyCash = visible.find((account) => account.kind === "cash");
	return anyCash?.id ?? null;
}

export function checkingBalance(plan: Plan): number | null {
	const id = checkingAccountId(plan);
	if (!id) return null;
	return (
		plan.accounts.find((account) => account.id === id && !account.archived)
			?.balance ?? null
	);
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
 * Expected next paycheck: total inflow into checking on the earliest date
 * after today, from outside the household or from the virtual pay account
 * (take-home transfer). Null when no upcoming inflow is projected.
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
			(!movement.fromId || movement.fromId === VIRTUAL_PAY_ACCOUNT_ID) &&
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
 * Cash cushion: checking balance minus spending since the checkpoint and
 * remaining unpaid monthly obligations. Card purchases do not reduce the
 * cushion here; they are budgeted against the next paycheck in the cycle
 * allowance.
 */
export function cashCushion({
	checking,
	spentSinceStart,
	remainingObligations,
}: {
	checking: number;
	spentSinceStart: number;
	remainingObligations: number;
}): number {
	return checking - spentSinceStart - remainingObligations;
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

export interface MandatorySpendingGroup {
	movementId: string;
	name: string;
	total: number;
	count: number;
	dates: string[];
}

/**
 * Narrow projection movements to a selected bill set. Null keeps every
 * movement, so the timing card counts all checking outflows by default.
 */
export function filterMovementsById(
	movements: MovementResult[],
	movementIds: string[] | null,
): MovementResult[] {
	if (!movementIds) return movements;
	const selected = new Set(movementIds);
	return movements.filter((movement) => selected.has(movement.movementId));
}

/**
 * Realized checking outflows inside (after, through]: money the projection
 * shows as already left between the checkpoint and today. The cash cushion
 * subtracts these so logged actuals dated after the projection start still
 * move today's figures.
 */
export function realizedCheckingOutflows({
	movements,
	checkingId,
	after,
	through,
}: {
	movements: MovementResult[];
	checkingId: string;
	after: string;
	through: string;
}): number {
	const start = after.slice(0, 10);
	const end = through.slice(0, 10);
	if (end <= start) return 0;
	return movements
		.filter(
			(movement) =>
				movement.fromId === checkingId &&
				movement.date > start &&
				movement.date <= end &&
				movement.realized > 0,
		)
		.reduce((sum, movement) => sum + movement.realized, 0);
}

/**
 * Mandatory spendings in an inclusive date window: checking outflows
 * grouped by movement, sorted by total descending. Powers the mandatory
 * visualization (remaining bills this month, fixed obligations next month).
 */
export function groupMandatorySpending({
	movements,
	checkingId,
	start,
	end,
}: {
	movements: MovementResult[];
	checkingId: string;
	start: string;
	end: string;
}): MandatorySpendingGroup[] {
	const groups = new Map<string, MandatorySpendingGroup>();
	for (const movement of movements) {
		if (movement.fromId !== checkingId) continue;
		if (movement.requested <= 0) continue;
		if (movement.date < start || movement.date > end) continue;
		const key = movement.movementId;
		const existing = groups.get(key);
		if (existing) {
			existing.total += movement.requested;
			existing.count += 1;
			if (!existing.dates.includes(movement.date)) {
				existing.dates.push(movement.date);
				existing.dates.sort();
			}
		} else {
			groups.set(key, {
				movementId: movement.movementId,
				name: movement.name || movement.movementId,
				total: movement.requested,
				count: 1,
				dates: [movement.date],
			});
		}
	}
	return [...groups.values()].sort(
		(a, b) => b.total - a.total || a.name.localeCompare(b.name),
	);
}
