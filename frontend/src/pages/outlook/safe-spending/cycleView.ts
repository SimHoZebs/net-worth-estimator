import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import {
	safeSpendingTrend,
	spendingLedger,
	ledgerHit,
	spendingAmount,
	type SafeSpendingScheduledIncrease,
} from "@/domain/safeSpendingTrend.ts";
import { buildCycleView, type CycleView } from "./safeSpendingDetailModel.ts";
import { monthEndIso } from "@/domain/safeSpending.ts";
import {
	hasUnknownSpending,
	roundCents,
	sumCents,
} from "@/domain/safeSpendingMath.ts";

export interface CycleViewInput {
	cycle: { start: string; end: string };
	referenceDay: string;
	transactions: AccountTransaction[];
	cashSummary?: SafeSpendingSummary;
	cardSpentByCard: { id: string; name: string; amount: number | null }[];
	reserve: number;
	fullDaysLeft: number;
	/** Posted external cash inflows; null means evidence is unavailable. */
	monthlyIncome?: number | null;
	scheduledOutflows?: SafeSpendingScheduledIncrease[];
	/**
	 * Selected-window cash remainder for non-current cycles. When provided
	 * (even as null) it replaces the current-range shape check; when absent
	 * the exact current-range derivation applies.
	 */
	remainingOverride?: number | null;
}

export interface CycleViewResult {
	view: CycleView;
	trend: ReturnType<typeof safeSpendingTrend>;
}

/**
 * One current cash-backed budget. The limit is net income plus the amount
 * in the selected cash accounts: what is there plus what is paying for
 * the cycle. It never depends on how much is already spent, and no bill,
 * hold, debt, or reserve deduction enters it. Cash after bills stays the
 * separate remaining figure; the reserve only offsets the safety net.
 * Without selected income the limit falls back to the cash evidence
 * reconstruction, spent plus cash after bills, so those budgets keep a
 * limit instead of going blank.
 */
export function cycleView({
	cycle,
	referenceDay,
	transactions,
	cashSummary,
	cardSpentByCard,
	reserve,
	fullDaysLeft,
	monthlyIncome,
	scheduledOutflows,
	remainingOverride,
}: CycleViewInput): CycleViewResult & { ledger: AccountTransaction[] } {
	const monthStart = `${referenceDay.slice(0, 7)}-01`;
	const recorded = spendingLedger({
		transactions,
		cycleStart: monthStart < cycle.start ? monthStart : cycle.start,
		cycleEnd: cycle.end,
		todayIso: referenceDay,
	});
	const ledger = spendingLedger({
		transactions: recorded,
		cycleStart: cycle.start,
		cycleEnd: cycle.end,
		todayIso: referenceDay,
	});
	const spent = sumCents(ledger, spendingAmount);
	const hasOverride = remainingOverride !== undefined;
	const remaining = hasOverride
		? remainingOverride
		: cashSummary?.status === "available" &&
			  cashSummary.start === referenceDay &&
			  cashSummary.end === monthEndIso(referenceDay) &&
			  cashSummary.cashAfterBills !== null &&
			  Number.isFinite(cashSummary.cashAfterBills)
			? cashSummary.cashAfterBills
			: null;
	const protectedReserve = Math.max(0, reserve);
	const unknownSpending = hasUnknownSpending(ledger);
	const cashInAccount =
		cashSummary?.status === "available" &&
		(hasOverride ||
			(cashSummary.start === referenceDay &&
				cashSummary.end === monthEndIso(referenceDay))) &&
		cashSummary.checkingAvailable !== null &&
		Number.isFinite(cashSummary.checkingAvailable)
			? cashSummary.checkingAvailable
			: null;
	const incomeKnown =
		monthlyIncome !== null &&
		monthlyIncome !== undefined &&
		Number.isFinite(monthlyIncome);
	const capacity =
		remaining === null || unknownSpending
			? null
			: incomeKnown
				? cashInAccount === null
					? null
					: roundCents(monthlyIncome + cashInAccount)
				: roundCents(spent + remaining);
	const trend = safeSpendingTrend({
		transactions: ledger,
		cycleStart: cycle.start,
		cycleEnd: cycle.end,
		todayIso: referenceDay,
		limit: capacity,
		safetyNet:
			capacity === null ? null : roundCents(capacity - protectedReserve),
		scheduledOutflows,
	});
	if (
		monthlyIncome !== null &&
		monthlyIncome !== undefined &&
		Number.isFinite(monthlyIncome)
	) {
		const monthlyLedger = recorded.filter((row) => row.date >= monthStart);
		const monthlySpent = hasUnknownSpending(monthlyLedger)
			? null
			: sumCents(monthlyLedger, spendingAmount);
		const hit =
			monthlySpent === null ? null : ledgerHit(monthlyLedger, monthlyIncome);
		const coordinate =
			monthlySpent === null || unknownSpending
				? null
				: roundCents(monthlyIncome);
		trend.monthlyIncome = {
			amount: monthlyIncome,
			spent: monthlySpent,
			coordinate,
			start: monthStart > cycle.start ? monthStart : cycle.start,
			end:
				monthEndIso(referenceDay) < cycle.end
					? monthEndIso(referenceDay)
					: cycle.end,
			hit:
				hit && coordinate !== null && hit.date >= cycle.start
					? { ...hit, amount: coordinate }
					: null,
		};
	}
	return {
		ledger,
		view: buildCycleView({
			cycleStart: cycle.start,
			cycleEnd: cycle.end,
			remaining,
			cardSpent: unknownSpending ? null : spent,
			cardSpentByCard,
			reserve: protectedReserve,
			fullDaysLeft,
		}),
		trend,
	};
}
