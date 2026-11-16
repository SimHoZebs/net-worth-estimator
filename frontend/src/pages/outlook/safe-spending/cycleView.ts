import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import {
	safeSpendingTrend,
	spendingLedger,
	ledgerHit,
	spendingAmount,
	type SafeSpendingScheduledBump,
} from "@/domain/safeSpendingTrend.ts";
import { buildCycleView, type CycleView } from "./safeSpendingDetailModel.ts";
import { monthEndIso } from "@/domain/safeSpending.ts";

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
	scheduledOutflows?: SafeSpendingScheduledBump[];
}

export interface CycleViewResult {
	view: CycleView;
	trend: ReturnType<typeof safeSpendingTrend>;
}

/**
 * One current cash-backed budget. Capacity reconstructs the current budget over
 * recorded cycle spending; it is neither historical bank cash nor an old budget.
 * Known cash already includes recorded bank movements: purchases are not deducted
 * from it again. Future income never enters this calculation.
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
	const spent =
		ledger.reduce(
			(total, row) => total + Math.round(spendingAmount(row) * 100),
			0,
		) / 100;
	const remaining =
		cashSummary?.status === "available" &&
		cashSummary.start === referenceDay &&
		cashSummary.end === monthEndIso(referenceDay) &&
		cashSummary.cashAfterBills !== null &&
		Number.isFinite(cashSummary.cashAfterBills)
			? cashSummary.cashAfterBills
			: null;
	const protectedReserve = Math.max(0, reserve);
	const capacity =
		remaining === null || ledger.some((row) => row.spendingAmountUnknown)
			? null
			: Math.round((spent + remaining) * 100) / 100;
	const trend = safeSpendingTrend({
		transactions: ledger,
		cycleStart: cycle.start,
		cycleEnd: cycle.end,
		todayIso: referenceDay,
		limit: capacity,
		safetyNet:
			capacity === null
				? null
				: Math.round((capacity - protectedReserve) * 100) / 100,
		scheduledOutflows,
	});
	if (
		monthlyIncome !== null &&
		monthlyIncome !== undefined &&
		Number.isFinite(monthlyIncome)
	) {
		const monthlyLedger = recorded.filter((row) => row.date >= monthStart);
		const monthlySpent = monthlyLedger.some((row) => row.spendingAmountUnknown)
			? null
			: monthlyLedger.reduce(
					(total, row) => total + Math.round(spendingAmount(row) * 100),
					0,
				) / 100;
		const hit =
			monthlySpent === null ? null : ledgerHit(monthlyLedger, monthlyIncome);
		const coordinate =
			monthlySpent === null || ledger.some((row) => row.spendingAmountUnknown)
				? null
				: Math.round(monthlyIncome * 100) / 100;
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
			cardSpent: ledger.some((row) => row.spendingAmountUnknown) ? null : spent,
			cardSpentByCard,
			reserve: protectedReserve,
			fullDaysLeft,
		}),
		trend,
	};
}
