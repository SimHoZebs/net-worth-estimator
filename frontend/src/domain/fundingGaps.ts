import { accountTransactions } from "./accountActivity.ts";
import { dateLabel, money } from "./format.ts";
import type { Plan } from "./model.ts";
import type { MovementResult, Projection } from "./result.ts";

export type FundingMovementKind =
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

export interface FundingGapMovement {
	id: string;
	date: string;
	name: string;
	/** Positive = money enters funding account; negative = money leaves. */
	amount: number;
	kind: FundingMovementKind;
	counterpartAccountName?: string;
}

export interface FundingGap {
	id: string;
	date: string;
	name: string;
	fundingAccount: FundingGapAccount;
	openingBalance: number;
	requiredAmount: number;
	windowStartDate: string;
	/** Execution order, same-day order significant. Never re-sort. */
	movements: FundingGapMovement[];
	currency?: string;
}

export interface FundingGapRow extends FundingGapMovement {
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
	const rows = gap.movements.map((movement) => {
		balance += movement.amount;
		if (movement.amount >= 0) moneyIn += movement.amount;
		else moneyOut -= movement.amount;
		return { ...movement, balanceAfter: balance };
	});
	const shortfall = Math.max(0, gap.requiredAmount - balance);
	const coveredAmount = Math.min(gap.requiredAmount, Math.max(0, balance));
	return {
		available: balance,
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

function kindFor(name: string, category: string): FundingMovementKind {
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
 * Derive inspectable funding gaps from base-case movements. The simulation
 * owns fundability: only movements with realized < requested (a funding
 * constraint) become gaps. The UI recomputes display totals only.
 */
export function deriveFundingGaps({
	plan,
	projection,
}: {
	plan: Plan;
	projection: Projection | null;
}): FundingGap[] {
	if (!projection) return [];
	// Execution order is projection.movements order (date, sequence).
	const failures = projection.movements.filter(
		(movement) => movement.requested - movement.realized > 0.5,
	);
	return failures.flatMap((failure: MovementResult): FundingGap[] => {
		const accountId = failure.fromId ?? failure.toId;
		if (!accountId) return [];
		const account = plan.accounts.find((item) => item.id === accountId);
		const accountName = account?.name ?? "Unknown account";
		const windowStart = monthStart(failure.date);
		// Opening is the balance before the window opens: the latest point
		// strictly before the window month. Points snapshot end-of-day
		// balances, so a same-month point already includes that month's
		// movements and reusing it would double-count the ledger below.
		const priorPoint = [...projection.points]
			.reverse()
			.find((point) => point.date < windowStart);
		const opening = priorPoint?.balances[accountId] ?? account?.balance ?? 0;
		// Only successfully executed movements affecting this account before
		// the failed payment, in execution order. Exclude the failed payment
		// itself and any later deposits.
		const ledger = accountTransactions({ accountId, plan, projection })
			.filter(
				(transaction) =>
					transaction.date >= windowStart &&
					transaction.date <= failure.date &&
					!(
						transaction.movementId === failure.movementId &&
						transaction.date === failure.date
					),
			)
			.sort((a, b) =>
				a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
			);
		// Cut off at the failure's position in execution order: projection
		// movements are already ordered, so keep ledger entries whose
		// (date, movementId) precedes the failure.
		const failureIndex = projection.movements.indexOf(failure);
		const orderedLedger = ledger.filter((transaction) => {
			const index = projection.movements.findIndex(
				(movement) =>
					movement.movementId === transaction.movementId &&
					movement.date === transaction.date,
			);
			return index === -1 || index < failureIndex;
		});
		const movements: FundingGapMovement[] = orderedLedger.map(
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
		const available =
			failure.available ??
			opening + movements.reduce((sum, item) => sum + item.amount, 0);
		if (Math.max(0, required - available) <= 0.5) return [];
		return [
			{
				id: `${failure.movementId}-${failure.date}`,
				date: failure.date,
				name: failure.name,
				fundingAccount: { id: accountId, name: accountName },
				openingBalance: opening,
				requiredAmount: required,
				windowStartDate: windowStart,
				movements,
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
