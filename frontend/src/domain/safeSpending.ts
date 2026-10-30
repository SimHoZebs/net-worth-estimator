import {
	externalCounterpartyName,
	type AccountTransaction,
} from "./accountActivity.ts";
import { isoDate, utcDate } from "./format.ts";
import {
	isPendingTransaction,
	type Account,
	type Transaction,
} from "./model.ts";
import type { TransactionResult } from "./result.ts";

// Server ownership: every amount summed here originates server-side.
// `transactions` are adapted `ProjectionResult.transactionEvents` (requested and
// realized per event); `spendingBalance` reads saved account balances surfaced
// as `ProjectionAccountSummary.startingBalance`. The Gap check
// (`requested - realized`) is the same gap the posting-fulfillment Goal
// check aggregates. Income source selection lives in safeSpendingIncome.ts.
// Only the windows stay client-side:
// they follow user-selected accounts, bills, statement day, and reserve,
// which have no server contract (see PRODUCT_INTENT open decisions on
// household safe spending). Do not add new windowed sums here; derive from these.

export const DEFAULT_CYCLE_STATEMENT_DAY = 20;
export const DEFAULT_PROTECTED_RESERVE = 725;

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

export function checkingAccountId(accounts: Account[]): string | null {
	const visible = accounts.filter((account) => !account.archived);
	const byId = visible.find((account) => account.id === "checking");
	if (byId) return byId.id;
	const cash = visible.find(
		(account) => account.kind === "cash" && account.enabled,
	);
	if (cash) return cash.id;
	const anyCash = visible.find((account) => account.kind === "cash");
	return anyCash?.id ?? null;
}

/**
 * Available-balance total: the summed balance of the accounts the user
 * counts as spendable. An empty set holds nothing.
 */
export function spendingBalance(
	accounts: Account[],
	accountIds: string[],
): number {
	const selected = new Set(accountIds);
	return accounts
		.filter((account) => selected.has(account.id) && !account.archived)
		.reduce((sum, account) => sum + account.balance, 0);
}

/**
 * Remaining unpaid monthly obligations: requested outflows from the
 * spendable accounts dated after today through the end of the current
 * calendar month.
 */
export function remainingMonthlyObligations({
	transactions,
	checkingIds,
	todayIso,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	todayIso: string;
}): { total: number; monthEnd: string } {
	const today = todayIso.slice(0, 10);
	const monthEnd = monthEndIso(today);
	const sources = new Set(checkingIds);
	const total = transactions
		.filter(
			(transaction) =>
				transaction.fromId !== null &&
				sources.has(transaction.fromId) &&
				transaction.date > today &&
				transaction.date <= monthEnd &&
				transaction.requested > 0,
		)
		.reduce((sum, transaction) => sum + transaction.requested, 0);
	return { total, monthEnd };
}

/** Next calendar month's fixed obligations from the spendable accounts. */
export function nextMonthObligations({
	transactions,
	checkingIds,
	todayIso,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	todayIso: string;
}): { total: number; start: string; end: string } {
	const { start, end } = nextMonthRange(todayIso);
	const sources = new Set(checkingIds);
	const total = transactions
		.filter(
			(transaction) =>
				transaction.fromId !== null &&
				sources.has(transaction.fromId) &&
				transaction.date >= start &&
				transaction.date <= end &&
				transaction.requested > 0,
		)
		.reduce((sum, transaction) => sum + transaction.requested, 0);
	return { total, start, end };
}

/**
 * Available balance: the selected balance minus spending since it was
 * confirmed and remaining unpaid monthly obligations. Card purchases do
 * not reduce it here; they are budgeted against the next paycheck in the
 * cycle allowance.
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

/**
 * Credit-card cycle allowance: expected next paycheck minus next month's
 * fixed obligations, spending already committed this cycle, and the
 * protected reserve. Independent of the current available balance.
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

/**
 * Incoming before reserve: what remains of the next paycheck after it
 * covers next month's fixed bills and the closed card balance. Future
 * money, never part of cash now. Null when no closing observation exists.
 */
export function paycheckBeforeReserve({
	paycheck,
	fixedObligations,
	closedTotal,
}: {
	paycheck: number;
	fixedObligations: number;
	closedTotal: number | null;
}): number | null {
	if (closedTotal === null) return null;
	return cycleAllowance({
		paycheck,
		fixedObligations,
		spent: closedTotal,
		reserve: 0,
	});
}

export interface MandatorySpendingGroup {
	transactionId: string;
	name: string;
	total: number;
	count: number;
	dates: string[];
}

/**
 * Narrow projection transactions to a selected bill set. Null keeps every
 * transaction, so the safe spending card counts all spendable-account outflows by
 * default.
 */
export function filterTransactionsById(
	transactions: TransactionResult[],
	transactionIds: string[] | null,
): TransactionResult[] {
	if (!transactionIds) return transactions;
	const selected = new Set(transactionIds);
	return transactions.filter((transaction) =>
		selected.has(transaction.transactionId),
	);
}

/**
 * Realized outflows from the spendable accounts inside (after, through]:
 * money the projection shows as already left between confirmation and
 * today. The available balance subtracts these so logged actuals dated
 * after the projection start still move today's figures.
 */
export function realizedCheckingOutflows({
	transactions,
	checkingIds,
	after,
	through,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	after: string;
	through: string;
}): number {
	const start = after.slice(0, 10);
	const end = through.slice(0, 10);
	if (end <= start) return 0;
	const sources = new Set(checkingIds);
	return transactions
		.filter(
			(transaction) =>
				transaction.fromId !== null &&
				sources.has(transaction.fromId) &&
				transaction.date > start &&
				transaction.date <= end &&
				transaction.realized > 0,
		)
		.reduce((sum, transaction) => sum + transaction.realized, 0);
}

/**
 * Canonical unfulfilled amounts inside (after, through], scoped to the
 * spendable accounts and bills window. The backend owns reportability and
 * destination-limit classification, just as for posting fulfillment.
 */
export function checkingShortfall({
	transactions,
	checkingIds,
	after,
	through,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	after: string;
	through: string;
}): { total: number; firstDate: string | null } {
	const start = after.slice(0, 10);
	const end = through.slice(0, 10);
	if (end <= start) return { total: 0, firstDate: null };
	const sources = new Set(checkingIds);
	let total = 0;
	let firstDate: string | null = null;
	for (const transaction of transactions) {
		if (transaction.fromId === null || !sources.has(transaction.fromId))
			continue;
		if (transaction.date <= start || transaction.date > end) continue;
		const gap = transaction.fulfillment?.unfulfilledAmount ?? 0;
		if (gap <= 0) continue;
		total += gap;
		if (firstDate === null || transaction.date < firstDate) {
			firstDate = transaction.date;
		}
	}
	return { total: Math.round(total * 100) / 100, firstDate };
}

/**
 * Bills in an inclusive date window: outflows from the spendable accounts
 * grouped by transaction, sorted by total descending. Powers the bills
 * visualization (remaining bills this month, fixed obligations next month).
 */
export function groupMandatorySpending({
	transactions,
	checkingIds,
	start,
	end,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	start: string;
	end: string;
}): MandatorySpendingGroup[] {
	const sources = new Set(checkingIds);
	const groups = new Map<string, MandatorySpendingGroup>();
	for (const transaction of transactions) {
		if (transaction.fromId === null || !sources.has(transaction.fromId))
			continue;
		if (transaction.requested <= 0) continue;
		if (transaction.date < start || transaction.date > end) continue;
		const key = transaction.transactionId;
		const existing = groups.get(key);
		if (existing) {
			existing.total += transaction.requested;
			existing.count += 1;
			if (!existing.dates.includes(transaction.date)) {
				existing.dates.push(transaction.date);
				existing.dates.sort();
			}
		} else {
			groups.set(key, {
				transactionId: transaction.transactionId,
				name: transaction.name || transaction.transactionId,
				total: transaction.requested,
				count: 1,
				dates: [transaction.date],
			});
		}
	}
	return [...groups.values()].sort(
		(a, b) => b.total - a.total || a.name.localeCompare(b.name),
	);
}

/**
 * Per-occurrence bill rows for a mandatory window: the same occurrences
 * backing groupMandatorySpending, shaped as AccountTransactions so the
 * bills tab renders the shared TransactionRow. Requested amounts sum to
 * the group totals; partially paid occurrences surface as shortfalls.
 */
export function mandatoryTransactions({
	transactions,
	checkingIds,
	start,
	end,
	accounts,
	savedTransactions,
}: {
	transactions: TransactionResult[];
	checkingIds: string[];
	start: string;
	end: string;
	accounts: Account[];
	savedTransactions: Transaction[];
}): AccountTransaction[] {
	const sources = new Set(checkingIds);
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const rows: AccountTransaction[] = [];
	const pendingIds = new Set(
		savedTransactions
			.filter(isPendingTransaction)
			.map((transaction) => transaction.id),
	);
	let index = 0;
	for (const transaction of transactions) {
		if (transaction.fromId === null || !sources.has(transaction.fromId))
			continue;
		if (transaction.requested <= 0) continue;
		if (transaction.date < start || transaction.date > end) continue;
		const counterparty = transaction.toId
			? (names.get(transaction.toId) ?? "Unknown account")
			: externalCounterpartyName("out");
		const amount = Math.max(0, transaction.realized);
		rows.push({
			id: `mandatory-${transaction.transactionId}-${transaction.date}-${index++}`,
			transactionId: transaction.transactionId,
			date: transaction.date,
			name: transaction.name || transaction.transactionId,
			source: "projected",
			direction: "out",
			category: transaction.toId ? "transfer" : "expense",
			counterparty,
			from: names.get(transaction.fromId) ?? "Unknown account",
			to: counterparty,
			amount,
			requested: transaction.requested,
			shortfall: Math.max(0, transaction.requested - amount),
			constraint: transaction.constraint,
			excluded: false,
			pending: pendingIds.has(transaction.transactionId),
			void: false,
		});
	}
	return rows;
}
