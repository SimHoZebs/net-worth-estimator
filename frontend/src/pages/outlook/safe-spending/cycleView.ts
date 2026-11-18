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
	closedCycle: CycleView["heroes"]["closedCycle"];
	fullDaysLeft: number;
	/** Posted external cash inflows; null means evidence is unavailable. */
	monthlyIncome?: number | null;
	/**
	 * Card debt incurred this cycle: card purchases minus card settlements
	 * paid from cash. Card spending never leaves checking, so without this
	 * deduction every card purchase would raise the reconstructed limit.
	 * Undefined preserves the legacy spent-plus-remaining reconstruction;
	 * null marks the debt unknown and clears the limit.
	 */
	cardDebtChange?: number | null;
	/**
	 * Income still expected inside the cycle after the reference day.
	 * Received income already sits inside cashAfterBills, so only the
	 * not-yet-arrived portion enters here and nothing is counted twice.
	 * Undefined preserves the legacy calculation; null clears the limit.
	 */
	futureCycleIncome?: number | null;
	scheduledOutflows?: SafeSpendingScheduledIncrease[];
}

export interface CycleViewResult {
	view: CycleView;
	trend: ReturnType<typeof safeSpendingTrend>;
}

/**
 * One current cash-backed budget. The limit is cash left plus the income
 * still arriving to pay for the cycle, minus card debt incurred but not
 * yet paid: starting cash plus cycle income, independent of how much of
 * it is already spent. Cash already reflects recorded bank movements, so
 * purchases are not deducted from it again; received income already sits
 * inside it, so only not-yet-arrived income enters separately.
 */
export function cycleView({
	cycle,
	referenceDay,
	transactions,
	cashSummary,
	cardSpentByCard,
	reserve,
	closedCycle,
	fullDaysLeft,
	monthlyIncome,
	scheduledOutflows,
	cardDebtChange,
	futureCycleIncome,
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
	const remaining =
		cashSummary?.status === "available" &&
		cashSummary.start === referenceDay &&
		cashSummary.end === monthEndIso(referenceDay) &&
		cashSummary.cashAfterBills !== null &&
		Number.isFinite(cashSummary.cashAfterBills)
			? cashSummary.cashAfterBills
			: null;
	const protectedReserve = Math.max(0, reserve);
	const unknownSpending = hasUnknownSpending(ledger);
	const debt = cardDebtChange === undefined ? 0 : cardDebtChange;
	const futureIncome =
		futureCycleIncome === undefined ? 0 : futureCycleIncome;
	const capacity =
		remaining === null ||
		unknownSpending ||
		debt === null ||
		!Number.isFinite(debt) ||
		futureIncome === null ||
		!Number.isFinite(futureIncome)
			? null
			: roundCents(spent + remaining - debt + futureIncome);
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
			closedCycle,
			remaining,
			cardSpent: unknownSpending ? null : spent,
			cardSpentByCard,
			reserve: protectedReserve,
			fullDaysLeft,
		}),
		trend,
	};
}
