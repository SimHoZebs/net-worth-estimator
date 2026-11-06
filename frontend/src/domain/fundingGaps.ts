import { accountTransactions } from "./accountActivity.ts";
import { dateLabel, money } from "./format.ts";
import type { Account, Transaction } from "./model.ts";
import type { TransactionResult, Projection } from "./result.ts";

export type FundingTransactionKind =
	| "income"
	| "housing"
	| "utilities"
	| "groceries"
	| "insurance"
	| "repair"
	| "transfer"
	| "tax"
	| "education"
	| "other";

export interface FundingGapAccount {
	id: string;
	name: string;
}

export interface FundingGapTransaction {
	id: string;
	date: string;
	name: string;
	/** Positive = money enters funding account; negative = money leaves. */
	amount: number;
	kind: FundingTransactionKind;
	counterpartAccountName?: string;
}

export interface FundingGap {
	id: string;
	date: string;
	name: string;
	fundingAccount: FundingGapAccount;
	openingBalance: number;
	requiredAmount: number;
	availableAmount: number;
	unfulfilledAmount: number;
	windowStartDate: string;
	/** Execution order, same-day order significant. Never re-sort. */
	transactions: FundingGapTransaction[];
	currency?: string;
}

export interface FundingGapRow extends FundingGapTransaction {
	balanceAfter: number;
}

export interface FundingGapSummary {
	available: number;
	shortfall: number;
	coveredAmount: number;
	coveragePercent: number;
	projectedBalanceIfExecuted: number;
	moneyIn: number;
	moneyOut: number;
	rows: FundingGapRow[];
}

export function summarizeFundingGap(gap: FundingGap): FundingGapSummary {
	let balance = gap.openingBalance;
	let moneyIn = 0;
	let moneyOut = 0;
	const rows = gap.transactions.map((transaction) => {
		balance += transaction.amount;
		if (transaction.amount >= 0) moneyIn += transaction.amount;
		else moneyOut -= transaction.amount;
		return { ...transaction, balanceAfter: balance };
	});
	const shortfall = gap.unfulfilledAmount;
	const coveredAmount = Math.max(0, gap.requiredAmount - shortfall);
	return {
		available: gap.availableAmount,
		shortfall,
		coveredAmount,
		coveragePercent:
			gap.requiredAmount > 0 ? (100 * coveredAmount) / gap.requiredAmount : 100,
		projectedBalanceIfExecuted: balance - gap.requiredAmount,
		moneyIn,
		moneyOut,
		rows,
	};
}

export function orderedFundingGaps(gaps: FundingGap[]): FundingGap[] {
	return [...gaps].sort((a, b) => a.date.localeCompare(b.date));
}

function kindFor(name: string, category: string): FundingTransactionKind {
	if (category === "transfer") return "transfer";
	const text = name.toLowerCase();
	if (/(payroll|salary|paycheck|interest|dividend|income)/.test(text))
		return "income";
	if (/(rent|mortgage|housing|home)/.test(text)) return "housing";
	if (/(electric|water|gas|utility|utilities|internet|phone)/.test(text))
		return "utilities";
	if (/(grocery|groceries|market)/.test(text)) return "groceries";
	if (/(insurance)/.test(text)) return "insurance";
	if (/(repair|maintenance)/.test(text)) return "repair";
	if (/(tax)/.test(text)) return "tax";
	if (/(tuition|school|education|college)/.test(text)) return "education";
	return "other";
}

function monthStart(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/**
 * Present the backend's per-event fulfillment assessment with account-history
 * evidence. The ledger explains the result; it never decides fundability.
 */
export function deriveFundingGaps({
	accounts,
	transactions,
	startDate,
	projection,
	transactionIds = null,
}: {
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	projection: Projection | null;
	transactionIds?: readonly string[] | null;
}): FundingGap[] {
	if (!projection) return [];
	const selectedIds = transactionIds === null ? null : new Set(transactionIds);
	const current = projection;
	// Execution order is projection.transactions order (date, sequence).
	const failures = current.transactions.filter(
		(transaction) =>
			(transaction.fulfillment?.unfulfilledAmount ?? 0) > 0 &&
			(selectedIds === null || selectedIds.has(transaction.transactionId)),
	);
	if (failures.length === 0) return [];
	// Shared indexes built once: accounts by id, projection position by
	// (transactionId, date), and failure positions in execution order.
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const projectionIndex = new Map<string, number>();
	current.transactions.forEach((transaction, index) => {
		const key = `${transaction.transactionId}\u0000${transaction.date}`;
		if (!projectionIndex.has(key)) projectionIndex.set(key, index);
	});
	const failureIndexByObject = new Map<TransactionResult, number>();
	current.transactions.forEach((transaction, index) => {
		// Failures are element references from the same array, so map them
		// directly instead of indexOf per failure.
		if ((transaction.fulfillment?.unfulfilledAmount ?? 0) > 0) {
			failureIndexByObject.set(transaction, index);
		}
	});
	// Points snapshot end-of-day balances; the opening is the latest array
	// element strictly before the window month (same-month points already
	// include that month's transactions). Scan once per distinct month
	// instead of copying and reversing the array per failure.
	const points = current.points;
	const priorPointByWindow = new Map<
		string,
		(typeof points)[number] | undefined
	>();
	const priorPoint = (
		windowStart: string,
	): (typeof points)[number] | undefined => {
		if (priorPointByWindow.has(windowStart))
			return priorPointByWindow.get(windowStart);
		let found: (typeof points)[number] | undefined;
		for (let i = points.length - 1; i >= 0; i--) {
			if (points[i]!.date < windowStart) {
				found = points[i];
				break;
			}
		}
		priorPointByWindow.set(windowStart, found);
		return found;
	};
	// One ledger build per funding account instead of per failure: group
	// failures, call accountTransactions once each, then slice per failure.
	const failuresByAccount = new Map<string, TransactionResult[]>();
	for (const failure of failures) {
		const accountId = failure.fromId ?? failure.toId;
		if (!accountId) continue;
		const group = failuresByAccount.get(accountId);
		if (group) group.push(failure);
		else failuresByAccount.set(accountId, [failure]);
	}
	const ledgerByAccount = new Map<
		string,
		ReturnType<typeof accountTransactions>
	>();
	for (const accountId of failuresByAccount.keys()) {
		ledgerByAccount.set(
			accountId,
			accountTransactions({
				accountId,
				accounts,
				transactions,
				startDate,
				projection: current,
			}),
		);
	}
	// Count duplicate failures per transaction and date. The count keeps the
	// React key unique without renumbering unrelated gaps on a refresh.
	const occurrenceByKey = new Map<string, number>();
	return failures.flatMap((failure: TransactionResult): FundingGap[] => {
		const baseKey = `${failure.transactionId}\u0000${failure.date}`;
		const occurrence = occurrenceByKey.get(baseKey) ?? 0;
		occurrenceByKey.set(baseKey, occurrence + 1);
		const accountId = failure.fromId ?? failure.toId;
		if (!accountId) return [];
		const account = accountById.get(accountId);
		const accountName = account?.name ?? "Unknown account";
		const windowStart = monthStart(failure.date);
		// Opening is the balance before the window opens: the latest point
		// strictly before the window month. Points snapshot end-of-day
		// balances, so a same-month point already includes that month's
		// transactions and reusing it would double-count the ledger below.
		const opening =
			priorPoint(windowStart)?.balances[accountId] ?? account?.balance ?? 0;
		// Only successfully executed transactions affecting this account before
		// the failed payment, in execution order. Exclude the failed payment
		// itself and any later deposits.
		const fullLedger = ledgerByAccount.get(accountId) ?? [];
		const failureIndex =
			failureIndexByObject.get(failure) ??
			projectionIndex.get(`${failure.transactionId}\u0000${failure.date}`) ??
			-1;
		const orderedLedger = fullLedger.filter(
			(transaction) =>
				transaction.date >= windowStart &&
				transaction.date <= failure.date &&
				!(
					transaction.transactionId === failure.transactionId &&
					transaction.date === failure.date
				) &&
				(() => {
					const index = projectionIndex.get(
						`${transaction.transactionId}\u0000${transaction.date}`,
					);
					return index === undefined || index < failureIndex;
				})(),
		);
		const entries: FundingGapTransaction[] = orderedLedger
			.sort((a, b) =>
				a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
			)
			.map((transaction) => ({
				id: transaction.id,
				date: transaction.date,
				name: transaction.name,
				amount:
					transaction.direction === "in"
						? Math.abs(transaction.amount)
						: -Math.abs(transaction.amount),
				kind: kindFor(transaction.name, transaction.flow),
				...(transaction.counterparty &&
				transaction.counterparty !== "External income" &&
				transaction.counterparty !== "External spending"
					? { counterpartAccountName: transaction.counterparty }
					: {}),
			}));
		const required = failure.requested;
		return [
			{
				// Fragments may share a rule and date (destination limits split
				// an occurrence). The per-key count keeps every gap distinct
				// without renumbering unrelated gaps when an earlier failure
				// appears.
				id: `${failure.transactionId}-${failure.date}-${occurrence}`,
				date: failure.date,
				name: failure.name,
				fundingAccount: { id: accountId, name: accountName },
				openingBalance: opening,
				requiredAmount: required,
				availableAmount: failure.available ?? failure.realized,
				unfulfilledAmount: failure.fulfillment!.unfulfilledAmount,
				windowStartDate: windowStart,
				transactions: entries,
			},
		];
	});
}

export function fundingGapCaption(gap: FundingGap): string {
	const summary = summarizeFundingGap(gap);
	return `${gap.name} on ${dateLabel(gap.date, true)}: ${money(summary.available)} available of ${money(gap.requiredAmount)} required, ${money(summary.shortfall)} short.`;
}
