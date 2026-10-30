import { accountTransactions } from "./accountActivity.ts";
import { dateLabel, money } from "./format.ts";
import type { Plan } from "./model.ts";
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
	plan,
	projection,
	postingIds = null,
}: {
	plan: Plan;
	projection: Projection | null;
	postingIds?: readonly string[] | null;
}): FundingGap[] {
	if (!projection) return [];
	const selectedIds = postingIds === null ? null : new Set(postingIds);
	// Execution order is projection.transactions order (date, sequence).
	const failures = projection.transactions.filter(
		(transaction) =>
			(transaction.fulfillment?.unfulfilledAmount ?? 0) > 0 &&
			(selectedIds === null || selectedIds.has(transaction.transactionId)),
	);
	return failures.flatMap((failure: TransactionResult): FundingGap[] => {
		const accountId = failure.fromId ?? failure.toId;
		if (!accountId) return [];
		const account = plan.accounts.find((item) => item.id === accountId);
		const accountName = account?.name ?? "Unknown account";
		const windowStart = monthStart(failure.date);
		// Opening is the balance before the window opens: the latest point
		// strictly before the window month. Points snapshot end-of-day
		// balances, so a same-month point already includes that month's
		// transactions and reusing it would double-count the ledger below.
		const priorPoint = [...projection.points]
			.reverse()
			.find((point) => point.date < windowStart);
		const opening = priorPoint?.balances[accountId] ?? account?.balance ?? 0;
		// Only successfully executed transactions affecting this account before
		// the failed payment, in execution order. Exclude the failed payment
		// itself and any later deposits.
		const ledger = accountTransactions({ accountId, plan, projection })
			.filter(
				(transaction) =>
					transaction.date >= windowStart &&
					transaction.date <= failure.date &&
					!(
						transaction.transactionId === failure.transactionId &&
						transaction.date === failure.date
					),
			)
			.sort((a, b) =>
				a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
			);
		// Cut off at the failure's position in execution order: projection
		// transactions are already ordered, so keep ledger entries whose
		// (date, transactionId) precedes the failure.
		const failureIndex = projection.transactions.indexOf(failure);
		const orderedLedger = ledger.filter((transaction) => {
			const index = projection.transactions.findIndex(
				(candidate) =>
					candidate.transactionId === transaction.transactionId &&
					candidate.date === transaction.date,
			);
			return index === -1 || index < failureIndex;
		});
		const transactions: FundingGapTransaction[] = orderedLedger.map(
			(transaction) => ({
				id: transaction.id,
				date: transaction.date,
				name: transaction.name,
				amount:
					transaction.direction === "in"
						? Math.abs(transaction.amount)
						: -Math.abs(transaction.amount),
				kind: kindFor(transaction.name, transaction.category),
				...(transaction.counterparty &&
				transaction.counterparty !== "External income" &&
				transaction.counterparty !== "External spending"
					? { counterpartAccountName: transaction.counterparty }
					: {}),
			}),
		);
		const required = failure.requested;
		return [
			{
				id: `${failure.transactionId}-${failure.date}`,
				date: failure.date,
				name: failure.name,
				fundingAccount: { id: accountId, name: accountName },
				openingBalance: opening,
				requiredAmount: required,
				availableAmount: failure.available ?? failure.realized,
				unfulfilledAmount: failure.fulfillment!.unfulfilledAmount,
				windowStartDate: windowStart,
				transactions,
			},
		];
	});
}

export function fundingGapCaption(gap: FundingGap): string {
	const summary = summarizeFundingGap(gap);
	return `${gap.name} on ${dateLabel(gap.date, true)}: ${money(summary.available)} available of ${money(gap.requiredAmount)} required, ${money(summary.shortfall)} short.`;
}

export function counterpartName(
	plan: Plan,
	id: string | null,
	fallback: string,
): string {
	if (!id) return fallback;
	return namesOrFallback(plan, id, fallback);
}

function namesOrFallback(plan: Plan, id: string, fallback: string): string {
	return plan.accounts.find((account) => account.id === id)?.name ?? fallback;
}
