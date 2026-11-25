import type { TransferLink } from "@/api/generated/model/transferLink.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import {
	accountTransactions,
	type AccountTransaction,
} from "@/domain/accountActivity.ts";
import { transactionCategoryLabels } from "@/domain/categories.ts";
import { isoDate } from "@/domain/format.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";

type SummaryWindow = Pick<
	SafeSpendingSummary,
	"cycleStart" | "cycleEnd" | "cashAsOf"
>;

export interface SafeSpendingActivitySummary {
	total: number | null;
	byCard: { id: string; name: string; amount: number | null }[];
}

export interface SafeSpendingActivity {
	spending: AccountTransaction[];
	cashPayments: AccountTransaction[];
	summary: SafeSpendingActivitySummary;
	cashPaymentsTotal: number | null;
	count: number;
}

const roundCents = (value: number): number => Math.round(value * 100) / 100;

function isSpendCategory(category: string | null | undefined): boolean {
	return (
		category != null &&
		Object.hasOwn(transactionCategoryLabels, category) &&
		category !== "INCOME" &&
		category !== "TRANSFER_IN" &&
		category !== "TRANSFER_OUT"
	);
}

function transferEdgeKey(link: TransferLink): string {
	return JSON.stringify([link.legA, link.legB].sort());
}

/** The summary owns a UTC calendar day, not an exact evidence instant. */
function activityUtcDay(saved: Transaction, fallback: string): string {
	const instant = saved.transactionTime;
	if (typeof instant !== "number" || !Number.isFinite(instant)) return fallback;
	const date = new Date(instant * 1000);
	return Number.isFinite(date.getTime()) ? isoDate(date) : fallback;
}

function activityRow({
	row,
	saved,
	transfer,
}: {
	row: AccountTransaction;
	saved: Transaction;
	transfer: boolean;
}): AccountTransaction {
	const direction = saved.fromId ? ("out" as const) : ("in" as const);
	const refund = direction === "in" && isSpendCategory(saved.category);
	const instant = saved.transactionTime;
	return {
		...row,
		direction,
		flow: transfer ? "transfer" : row.flow,
		sortDate:
			typeof instant === "number" && Number.isFinite(instant)
				? new Date(instant * 1000).toISOString()
				: row.date,
		spendingAmount: transfer
			? 0
			: direction === "out"
				? row.amount
				: refund
					? -row.amount
					: 0,
		spendingAmountUnknown:
			!transfer &&
			saved.category !== "INCOME" &&
			(direction === "out" || refund) &&
			saved.amountKnown === false,
	};
}

function knownTotal(
	rows: readonly AccountTransaction[],
	amountOf: (row: AccountTransaction) => number,
	unknown: (row: AccountTransaction) => boolean,
): number | null {
	if (rows.some(unknown)) return null;
	const cents = rows.reduce(
		(total, row) => total + Math.round(amountOf(row) * 100),
		0,
	);
	return roundCents(cents / 100);
}

function sortRows(
	rows: readonly AccountTransaction[],
	order: TransactionOrder,
): AccountTransaction[] {
	return sortTransactionsByDate({
		items: rows,
		getDate: (row) => row.sortDate ?? row.date,
		getId: (row) => row.id,
		order,
	});
}

/**
 * Recorded activity for the server-owned active spending cycle. The cycle is
 * reset-day inclusive through the day before the next reset, capped at the full
 * `cashAsOf` UTC day because the summary does not expose an exact instant.
 * This adapter only selects and groups saved rows for display; it does not
 * recreate allowance, bill, payoff, or threshold calculations.
 */
export function buildSafeSpendingActivity({
	accounts,
	transactions,
	trackedIds,
	spendingIds,
	summary,
	transferLinks = [],
	order = DEFAULT_TRANSACTION_ORDER,
}: {
	accounts: Account[];
	transactions: Transaction[];
	trackedIds: string[];
	spendingIds: string[];
	summary: SummaryWindow;
	transferLinks?: TransferLink[];
	order?: TransactionOrder;
}): SafeSpendingActivity {
	const savedById = new Map(transactions.map((row) => [row.id, row]));
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const cardIds = [...new Set(trackedIds)];
	const cashIds = [...new Set(spendingIds)];
	const linkById = new Map<string, TransferLink>();
	for (const link of transferLinks) {
		linkById.set(link.legA, link);
		linkById.set(link.legB, link);
	}

	const end =
		summary.cycleEnd < summary.cashAsOf ? summary.cycleEnd : summary.cashAsOf;
	const spendingById = new Map<string, AccountTransaction>();
	const cashByEdge = new Map<string, AccountTransaction>();
	const selections = [
		...cardIds.map((accountId) => ({ accountId, cash: false })),
		...cashIds.map((accountId) => ({ accountId, cash: true })),
	];
	for (const { accountId, cash } of selections) {
		for (const row of accountTransactions({
			accountId,
			accounts,
			transactions,
			startDate: summary.cashAsOf,
		})) {
			const saved = savedById.get(row.transactionId);
			const day = saved ? activityUtcDay(saved, row.date) : row.date;
			if (
				!saved ||
				saved.kind !== "transaction" ||
				row.source !== "historical" ||
				saved.void ||
				(!saved.enabled && !saved.pending) ||
				(!saved.pending && row.excluded) ||
				day < summary.cycleStart ||
				day > end
			)
				continue;
			const link = linkById.get(saved.id);
			const transfer = Boolean(saved.fromId && saved.toId) || Boolean(link);
			const activity = activityRow({ row, saved, transfer });
			if (transfer) {
				// Cash payments are the outgoing cash leg. The opposite card or
				// cash leg remains inspectable through its confirmed link without
				// being counted or rendered a second time.
				if (!cash || activity.direction !== "out") continue;
				const key = link ? transferEdgeKey(link) : saved.id;
				if (!cashByEdge.has(key)) cashByEdge.set(key, activity);
				continue;
			}
			if (
				saved.category === "INCOME" ||
				(activity.direction === "in" && !isSpendCategory(saved.category))
			)
				continue;
			if (!spendingById.has(saved.id)) spendingById.set(saved.id, activity);
		}
	}

	const spending = sortRows([...spendingById.values()], order);
	const cashPayments = sortRows([...cashByEdge.values()], order);
	const byCard = cardIds.map((id) => {
		const rows = spending.filter((row) => {
			const saved = savedById.get(row.transactionId);
			return saved?.fromId === id || saved?.toId === id;
		});
		return {
			id,
			name: accountById.get(id)?.name ?? id,
			amount: knownTotal(
				rows,
				(row) => row.spendingAmount ?? 0,
				(row) => row.spendingAmountUnknown === true,
			),
		};
	});
	return {
		spending,
		cashPayments,
		summary: {
			total: knownTotal(
				spending,
				(row) => row.spendingAmount ?? 0,
				(row) => row.spendingAmountUnknown === true,
			),
			byCard,
		},
		cashPaymentsTotal: knownTotal(
			cashPayments,
			(row) => row.amount,
			(row) => savedById.get(row.transactionId)?.amountKnown === false,
		),
		count: spending.length + cashPayments.length,
	};
}
