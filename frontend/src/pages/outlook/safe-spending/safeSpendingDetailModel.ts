import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { ClosedCardBalances } from "../../../domain/closedCardBalances.ts";

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

export interface PaycheckDecomposition {
	paycheck: number;
	fixed: number;
	reserve: number;
	spent: number;
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
	paycheckAmount: number;
	paycheckDate: string | null;
	paycheckEndDate: string | null;
	fixedAmount: number;
	reserveAmount: number;
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
	frequency: string;
}
