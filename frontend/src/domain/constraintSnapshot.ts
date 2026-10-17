import {
	accountTransactions,
	type AccountTransaction,
} from "./accountActivity.ts";
import { dateLabel, money, monthDay } from "./format.ts";
import type { Account, Movement, Plan } from "./model.ts";
import type { MovementResult, Projection } from "./result.ts";

export interface LedgerRow {
	transaction: AccountTransaction;
	movement: Movement | null;
	failing: boolean;
}

export interface FailureLedger {
	accountName: string;
	accountIcon: Pick<Account, "id" | "kind" | "color"> | null;
	month: string;
	rows: LedgerRow[];
	overflow: number;
	summary: string;
}

// Peers past this count collapse into "+N more": the list stays a glance,
// and the failing movement is always shown.
const PEER_CAP = 5;

function monthKey(date: string): string {
	return date.slice(0, 7);
}

function byTime(
	a: { transaction: AccountTransaction },
	b: { transaction: AccountTransaction },
): number {
	return a.transaction.date < b.transaction.date
		? -1
		: a.transaction.date > b.transaction.date
			? 1
			: a.transaction.id < b.transaction.id
				? -1
				: 1;
}

// The failure month as real transaction rows: the same figures the account
// dialog shows, with the failing movement riding inline. Selection, cap,
// and order live here so the component stays a thin table.
export function failureLedger({
	plan,
	projection,
	failure,
}: {
	plan: Plan;
	projection: Projection;
	failure: MovementResult;
}): FailureLedger | null {
	const accountId = failure.fromId ?? failure.toId;
	if (!accountId) return null;
	const account = plan.accounts.find((item) => item.id === accountId);
	const accountName = account?.name ?? "Unknown account";
	const accountIcon = account
		? { id: account.id, kind: account.kind, color: account.color }
		: null;
	const month = dateLabel(`${monthKey(failure.date)}-01`);
	const candidates = accountTransactions({
		accountId,
		plan,
		projection,
	}).filter(
		(transaction) =>
			transaction.source === "projected" &&
			monthKey(transaction.date) === monthKey(failure.date),
	);
	const failing = candidates.find(
		(transaction) =>
			transaction.movementId === failure.movementId &&
			transaction.date === failure.date,
	);
	const peers = candidates.filter((transaction) => transaction !== failing);
	const shown =
		peers.length > PEER_CAP
			? [...peers]
					.sort(
						(a, b) =>
							Math.abs(Date.parse(a.date) - Date.parse(failure.date)) -
								Math.abs(Date.parse(b.date) - Date.parse(failure.date)) ||
							(a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
							(a.id < b.id ? -1 : 1),
					)
					.slice(0, PEER_CAP)
			: peers;
	const movements = new Map(plan.movements.map((item) => [item.id, item]));
	const toRow = (
		transaction: AccountTransaction,
		isFailing: boolean,
	): LedgerRow => ({
		transaction,
		movement: movements.get(transaction.movementId) ?? null,
		failing: isFailing,
	});
	const rows = [
		...shown.map((transaction) => toRow(transaction, false)),
		...(failing ? [toRow(failing, true)] : []),
	].sort(byTime);
	const overflow = peers.length - shown.length;
	const signed = (transaction: AccountTransaction) =>
		`${transaction.amount === 0 ? "" : transaction.direction === "in" ? "+" : "−"}${money(transaction.amount)}`;
	const summary =
		`${accountName} during ${month}: ` +
		rows
			.map(
				({ transaction, failing: isFailing }) =>
					`${transaction.name} ${monthDay(transaction.date)} ${signed(transaction)}` +
					(isFailing
						? `, short ${money(failure.requested - failure.realized)}`
						: ""),
			)
			.join("; ") +
		(overflow > 0 ? `; plus ${overflow} more` : "") +
		".";
	return { accountName, accountIcon, month, rows, overflow, summary };
}
