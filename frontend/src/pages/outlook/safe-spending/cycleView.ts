import type { AccountTransaction } from "@/domain/accountActivity.ts";
import { monthDay, sum } from "@/domain/format.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import type { TransactionResult } from "@/domain/result.ts";
import {
	cashCushion,
	checkingShortfall,
	mandatoryTransactions,
	nextMonthObligations,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
} from "@/domain/safeSpending.ts";
import { safeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import {
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import {
	buildCycleView,
	type CycleView,
	type SafeSpendingMandatorySection,
	type StatementFunding,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export interface CycleViewInput {
	cycle: { start: string; end: string };
	referenceDay: string;
	checking: number;
	spentSince: string;
	spentThrough: string;
	spendingIds: string[];
	results: TransactionResult[];
	obligationResults: TransactionResult[];
	directResults: TransactionResult[];
	billResults: TransactionResult[];
	billWindowStart: string;
	cardTransactions: AccountTransaction[];
	cardSpent: number | null;
	cardSpentByCard: { id: string; name: string; amount: number | null }[];
	funding: StatementFunding;
	reserve: number;
	accounts: Account[];
	savedTransactions: Transaction[];
	transactionOrder: TransactionOrder;
	closedCycle: CycleView["heroes"]["closedCycle"];
	provisional?: boolean;
	fullDaysLeft: number;
	closed?: boolean;
}

export interface CycleViewResult {
	view: CycleView;
	section: SafeSpendingMandatorySection;
	trend: ReturnType<typeof safeSpendingTrend>;
}

/**
 * One statement tab from the shared cash, allowance, bills, and pace
 * formulas. The open and closed tabs pass different windows and balances;
 * the calculation is the same.
 */
export function cycleView({
	cycle,
	referenceDay,
	checking,
	spentSince,
	spentThrough,
	spendingIds,
	results,
	obligationResults,
	directResults,
	billResults,
	billWindowStart,
	cardTransactions,
	cardSpent,
	cardSpentByCard,
	funding,
	reserve,
	accounts,
	savedTransactions,
	transactionOrder,
	closedCycle,
	fullDaysLeft,
	provisional = false,
	closed = false,
}: CycleViewInput): CycleViewResult {
	const spentSinceStart = spendingIds.length
		? realizedCheckingOutflows({
				transactions: results,
				checkingIds: spendingIds,
				after: spentSince,
				through: spentThrough,
			})
		: 0;
	const directSpentSinceStart = spendingIds.length
		? realizedCheckingOutflows({
				transactions: directResults,
				checkingIds: spendingIds,
				after: spentSince,
				through: spentThrough,
			})
		: 0;
	const bills = remainingMonthlyObligations({
		transactions: obligationResults,
		checkingIds: spendingIds,
		todayIso: referenceDay,
	});
	const short = checkingShortfall({
		transactions: obligationResults,
		checkingIds: spendingIds,
		after: referenceDay,
		through: bills.monthEnd,
	});
	const cushion = cashCushion({
		checking,
		spentSinceStart,
		remainingObligations: bills.total,
	});
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
		checking,
		spentSinceStart,
		directSpentSinceStart,
		bills: bills.total,
		cushion,
		since: spentSince,
		monthEnd: bills.monthEnd,
		short: short.total,
		firstShort: short.firstDate,
		funding: fundingWithBills,
		cardSpent,
		cardSpentByCard,
		reserve,
		fullDaysLeft,
		provisional,
	});
	const billTransactions = sortTransactionsByDate({
		items: mandatoryTransactions({
			transactions: billResults,
			checkingIds: spendingIds,
			start: billWindowStart,
			end: cycle.end,
			accounts,
			savedTransactions,
		}),
		getDate: (transaction) => transaction.date,
		getId: (transaction) => transaction.id,
		order: transactionOrder,
	});
	const limit = funding.paycheck - fixedBills;
	return {
		view,
		section: {
			title: closed ? labels.billsThisCycle : labels.scheduledBills,
			subtitle: `Scheduled amounts · ${monthDay(billWindowStart)} – ${monthDay(cycle.end)}`,
			total: sum(billTransactions.map((transaction) => transaction.requested)),
			transactions: billTransactions,
		},
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
