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
// Only the windows stay client-side; do not add new windowed sums here.

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

export interface MandatorySpendingGroup {
	transactionId: string;
	name: string;
	total: number;
	count: number;
	dates: string[];
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
	const dateSets = new Map<string, Set<string>>();
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
			dateSets.get(key)!.add(transaction.date);
		} else {
			groups.set(key, {
				transactionId: transaction.transactionId,
				name: transaction.name || transaction.transactionId,
				total: transaction.requested,
				count: 1,
				dates: [],
			});
			dateSets.set(key, new Set([transaction.date]));
		}
	}
	for (const [key, group] of groups) {
		group.dates = [...dateSets.get(key)!].sort();
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
			flow: transaction.toId ? "transfer" : "expense",
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
