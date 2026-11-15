import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import {
	safeSpendingTrend,
	spendingLedger,
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
}: CycleViewInput): CycleViewResult & { ledger: AccountTransaction[] } {
	const ledger = spendingLedger({
		transactions,
		cycleStart: cycle.start,
		cycleEnd: cycle.end,
		todayIso: referenceDay,
	});
	const spent =
		ledger.reduce((total, row) => total + Math.round(row.amount * 100), 0) /
		100;
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
		remaining === null ? null : Math.round((spent + remaining) * 100) / 100;
	return {
		ledger,
		view: buildCycleView({
			cycleStart: cycle.start,
			cycleEnd: cycle.end,
			closedCycle,
			remaining,
			cardSpent: spent,
			cardSpentByCard,
			reserve: protectedReserve,
			fullDaysLeft,
		}),
		trend: safeSpendingTrend({
			transactions: ledger,
			cycleStart: cycle.start,
			cycleEnd: cycle.end,
			todayIso: referenceDay,
			limit: capacity,
			safetyNet:
				capacity === null
					? null
					: Math.round((capacity - protectedReserve) * 100) / 100,
		}),
	};
}
