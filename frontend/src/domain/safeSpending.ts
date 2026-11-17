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
import { inWindow, occurrenceKey } from "./safeSpendingMath.ts";

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

/** One predicate for a bill occurrence in a mandatory window. */
function isMandatoryOccurrence(
	row: TransactionResult,
	sources: ReadonlySet<string>,
	start: string,
	end: string,
): boolean {
	return (
		row.fromId !== null &&
		sources.has(row.fromId) &&
		row.requested > 0 &&
		inWindow(row.date, start, end)
	);
}

/**
 * Per-occurrence bill rows for a mandatory window, shaped as
 * AccountTransactions so the bills tab renders the shared TransactionRow.
 * Partially paid occurrences surface as shortfalls.
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
		if (!isMandatoryOccurrence(transaction, sources, start, end)) continue;
		const counterparty = transaction.toId
			? (names.get(transaction.toId) ?? "Unknown account")
			: externalCounterpartyName("out");
		const amount = Math.max(0, transaction.realized);
		rows.push({
			id: `mandatory-${occurrenceKey(transaction.transactionId, transaction.date)}-${index++}`,
			transactionId: transaction.transactionId,
			date: transaction.date,
			name: transaction.name || transaction.transactionId,
			source: "projected",
			direction: "out",
			flow: transaction.toId ? "transfer" : "expense",
			counterparty,
			from: names.get(transaction.fromId!) ?? "Unknown account",
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
