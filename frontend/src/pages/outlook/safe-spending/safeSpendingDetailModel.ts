import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { ClosedCardBalances } from "../../../domain/closedCardBalances.ts";
import { dateLabel, monthDay } from "../../../domain/format.ts";

export const SAFE_SPENDING_DETAIL_TABS = [
	{ id: "cycle", label: "This cycle", view: "charges" },
	{ id: "last-cycle", label: "Last cycle", view: "charges" },
	{ id: "configure", label: "Configure", view: "configure" },
] as const;

export type SafeSpendingDetailTab =
	(typeof SAFE_SPENDING_DETAIL_TABS)[number]["id"];
export type SafeSpendingCycleTab = Extract<
	(typeof SAFE_SPENDING_DETAIL_TABS)[number],
	{ view: "charges" }
>["id"];

export function isSafeSpendingCycleTab(
	tab: SafeSpendingDetailTab,
): tab is SafeSpendingCycleTab {
	return SAFE_SPENDING_DETAIL_TABS.some(
		(item) => item.id === tab && item.view === "charges",
	);
}

export function cycleCaption({
	start,
	end,
	closed,
	daysLeft,
}: {
	start: string;
	end: string;
	closed: boolean;
	daysLeft: number;
}): string {
	return closed
		? `${dateLabel(start, true)} – ${dateLabel(end, true)} · Closed`
		: `${dateLabel(end, true)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}
/**
 * The statement-settlement bundle plus the bills window it covers: the
 * selected income arriving after the statement closes, and the calendar
 * month after the close month (the obligations that paycheck absorbs before
 * the next payday).
 */
export interface StatementFunding {
	paycheck: number;
	date: string | null;
	endDate: string | null;
	fixedBills: number;
}

/** "Oct 29" or "Oct 29 – Nov 10", null while no occurrence exists. */
export function bundleDatesText(bundle: {
	date: string | null;
	endDate: string | null;
}): string | null {
	if (bundle.date === null) return null;
	return bundle.endDate !== null && bundle.endDate !== bundle.date
		? `${monthDay(bundle.date)} – ${monthDay(bundle.endDate)}`
		: monthDay(bundle.date);
}

export type SafeSpendingClosedCycle = ClosedCardBalances & {
	start: string;
	end: string;
};

export interface SafeSpendingChargeCycle {
	start: string;
	end: string;
	title: string;
	emptyMessage: string;
	transactions: AccountTransaction[];
	showTotal?: boolean;
	/** Spent total plus per-card breakdown shown above the modal table. */
	summary?: {
		total: number | null;
		byCard: { id: string; name: string; amount: number | null }[];
	};
	/** Actual dates whose cumulative card spending crossed each threshold. */
	thresholds?: {
		safetyNetDate: string | null;
		limitDate: string | null;
	};
}

export interface SafeSpendingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	transactions: AccountTransaction[];
}

/** The allocation figures the This-cycle panel renders; the funding bundle lives on StatementFunding. */
export interface CycleAllocation {
	reserve: number;
	allowance: number;
	/** False when a closed card balance is missing and no allowance can be stated. */
	available: boolean;
}

export interface SafeSpendingHeroes {
	safe: number;
	theoretical: number;
	dailySafe: number;
	dailyTheoretical: number;
	fullDaysLeft: number;
	cycleStart: string;
	cycleEnd: string;
	closedCycle: SafeSpendingClosedCycle;
	committedTotal: number | null;
	committedByCard: { id: string; name: string; amount: number | null }[];
}

export interface CycleView {
	heroes: SafeSpendingHeroes;
	allocation: CycleAllocation;
	funding: StatementFunding;
}

/**
 * Assemble card allowance figures. A null card amount explicitly disables the allowance.
 */
export function buildCycleView({
	cycleStart,
	cycleEnd,
	closedCycle,
	funding,
	cardSpent,
	cardSpentByCard,
	reserve,
	fullDaysLeft,
}: {
	cycleStart: string;
	cycleEnd: string;
	closedCycle: SafeSpendingClosedCycle;
	funding: StatementFunding;
	cardSpent: number | null;
	cardSpentByCard: { id: string; name: string; amount: number | null }[];
	reserve: number;
	fullDaysLeft: number;
}): CycleView {
	const available = cardSpent !== null;
	const closedCards = cardSpent ?? 0;
	const paycheck = funding.paycheck;
	const allowance = available
		? paycheck - funding.fixedBills - closedCards - reserve
		: 0;
	const theoretical = available
		? paycheck - funding.fixedBills - closedCards
		: 0;
	const days = Math.max(1, fullDaysLeft);
	const dailySafe = allowance / days;
	const dailyTheoretical = theoretical / days;
	return {
		heroes: {
			safe: allowance,
			theoretical,
			dailySafe,
			dailyTheoretical,
			fullDaysLeft: days,
			cycleStart,
			cycleEnd,
			closedCycle,
			committedTotal: cardSpent,
			committedByCard: cardSpentByCard,
		},
		allocation: { reserve, allowance, available },
		funding,
	};
}

export interface SafeSpendingConfigHints {
	statementDay: number;
	reserve: number;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
	incomeAccounts: { id: string; name: string }[];
	trackedIncomeIds: string[];
}

export interface BillCandidate {
	id: string;
	name: string;
	amount: number;
}
