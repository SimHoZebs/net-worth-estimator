import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { ClosedCardBalances } from "../../../domain/closedCardBalances.ts";
import { monthDay } from "../../../domain/format.ts";

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
export interface CashNowDecomposition {
	checking: number;
	spentSinceStart: number;
	/** Past direct cash outflows since the balance check, kept outside bill filters. */
	directSpentSinceStart?: number;
	bills: number;
	cushion: number;
	/** Projection-start date anchoring spentSinceStart, for caption context. */
	since: string;
	/** Last day of the calendar-month bills window, for caption context. */
	monthEnd: string;
	/** Simulated unpaid bills in the due window (fulfillment gaps). */
	short: number;
	/** First date the simulation leaves a bill unpaid, if any. */
	firstShort: string | null;
}

/** The allocation figures the This-cycle panel renders; the funding bundle lives on StatementFunding. */
export interface CycleAllocation {
	reserve: number;
	allowance: number;
}

export interface SafeSpendingHeroes {
	cushion: number;
	cushionProvisional: boolean;
	checkingAmount: number;
	checkingObservedOn: string | null;
	safe: number;
	theoretical: number;
	dailySafe: number;
	dailyTheoretical: number;
	fullDaysLeft: number;
	cycleStart: string;
	cycleEnd: string;
	closedCycle: SafeSpendingClosedCycle;
	committedTotal: number;
	recordedTotal: number;
	committedByCard: { id: string; name: string; amount: number }[];
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
