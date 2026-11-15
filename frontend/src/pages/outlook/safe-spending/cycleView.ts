import type { AccountTransaction } from "@/domain/accountActivity.ts";
import type { TransactionResult } from "@/domain/result.ts";
import { nextMonthObligations } from "@/domain/safeSpending.ts";
import { safeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import {
	buildCycleView,
	type CycleView,
	type StatementFunding,
} from "./safeSpendingDetailModel.ts";

export interface CycleViewInput {
	cycle: { start: string; end: string };
	referenceDay: string;
	spendingIds: string[];
	obligationResults: TransactionResult[];
	cardTransactions: AccountTransaction[];
	cardSpent: number | null;
	cardSpentByCard: { id: string; name: string; amount: number | null }[];
	funding: StatementFunding;
	reserve: number;
	closedCycle: CycleView["heroes"]["closedCycle"];
	fullDaysLeft: number;
}

export interface CycleViewResult {
	view: CycleView;
	trend: ReturnType<typeof safeSpendingTrend>;
}

/**
 * Current card allowance and pace. Cash evidence is owned by the server summary.
 */
export function cycleView({
	cycle,
	referenceDay,
	spendingIds,
	obligationResults,
	cardTransactions,
	cardSpent,
	cardSpentByCard,
	funding,
	reserve,
	closedCycle,
	fullDaysLeft,
}: CycleViewInput): CycleViewResult {
	const fixedBills = spendingIds.length
		? nextMonthObligations({
				transactions: obligationResults,
				checkingIds: spendingIds,
				todayIso: cycle.end,
			}).total
		: 0;
	const fundingWithBills = { ...funding, fixedBills };
	const view = buildCycleView({
		cycleStart: cycle.start,
		cycleEnd: cycle.end,
		closedCycle,
		funding: fundingWithBills,
		cardSpent,
		cardSpentByCard,
		reserve,
		fullDaysLeft,
	});
	const limit = funding.paycheck - fixedBills;
	return {
		view,
		trend: safeSpendingTrend({
			transactions: cardTransactions,
			cycleStart: cycle.start,
			cycleEnd: cycle.end,
			todayIso: referenceDay,
			limit,
			safetyNet: limit - reserve,
		}),
	};
}
