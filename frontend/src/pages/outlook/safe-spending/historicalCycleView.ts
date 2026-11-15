import { monthDay, sum } from "@/domain/format.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import type { TransactionResult } from "@/domain/result.ts";
import { mandatoryTransactions } from "@/domain/safeSpending.ts";
import { safeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import { sortTransactionsByDate } from "@/domain/transactionSort.ts";
import type { TransactionOrder } from "@/domain/transactionSort.ts";
import type { SafeSpendingMandatorySection } from "./safeSpendingDetailModel.ts";
import { buildCycleView } from "./safeSpendingDetailModel.ts";
import type { CycleViewInput, CycleViewResult } from "./cycleView.ts";

/** Recorded activity is evidence of charges, not cash at close or a historical budget. */
export function historicalCycleView({
	closedCycle,
	cardTransactions,
	billResults,
	spendingIds,
	accounts,
	savedTransactions,
	transactionOrder,
}: Pick<CycleViewInput, "closedCycle" | "cardTransactions" | "spendingIds"> & {
	billResults: TransactionResult[];
	accounts: Account[];
	savedTransactions: Transaction[];
	transactionOrder: TransactionOrder;
}): CycleViewResult & { section: SafeSpendingMandatorySection } {
	const transactions = sortTransactionsByDate({
		items: mandatoryTransactions({
			transactions: billResults.filter((row) => row.posted === true),
			checkingIds: spendingIds,
			start: closedCycle.start,
			end: closedCycle.end,
			accounts,
			savedTransactions,
		}).map((row) => ({ ...row, source: "historical" as const })),
		getDate: (row) => row.date,
		getId: (row) => row.id,
		order: transactionOrder,
	});
	const trend = safeSpendingTrend({
		transactions: cardTransactions,
		cycleStart: closedCycle.start,
		cycleEnd: closedCycle.end,
		todayIso: closedCycle.end,
		limit: null,
		safetyNet: null,
	});
	const view = buildCycleView({
		cycleStart: closedCycle.start,
		cycleEnd: closedCycle.end,
		closedCycle,
		funding: { paycheck: 0, date: null, endDate: null, fixedBills: 0 },
		cardSpent: null,
		cardSpentByCard: [],
		reserve: 0,
		fullDaysLeft: trend.actual.length,
	});
	// The activity total stays separate from the independently evidenced closed debt.
	view.heroes.committedTotal = trend.actual.at(-1)?.spent ?? 0;
	view.heroes.committedByCard = [];
	return {
		view,
		trend,
		section: {
			title: "Recorded bill payments this cycle",
			subtitle: `Recorded amounts · ${monthDay(closedCycle.start)} – ${monthDay(closedCycle.end)}`,
			total: sum(transactions.map((row) => row.amount)),
			transactions,
		},
	};
}
