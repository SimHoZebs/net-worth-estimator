import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { ClosedCardBalances } from "../../../domain/closedCardBalances.ts";
import { dateLabel } from "../../../domain/format.ts";

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
	/** Exact recorded spending rows that first crossed the current budget. */
	thresholds?: {
		safetyNetTransactionId: string | null;
		limitTransactionId: string | null;
	};
}

export interface SafeSpendingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	transactions: AccountTransaction[];
}

/** The current cash-backed allowance after the protected reserve. */
export interface CycleAllocation {
	reserve: number;
	allowance: number;
	/** False when current cash evidence cannot support an allowance. */
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
}

/**
 * Project the shared remaining headroom into the current decision rows.
 */
export function buildCycleView({
	cycleStart,
	cycleEnd,
	closedCycle,
	remaining,
	cardSpent,
	cardSpentByCard,
	reserve,
	fullDaysLeft,
}: {
	cycleStart: string;
	cycleEnd: string;
	closedCycle: SafeSpendingClosedCycle;
	remaining: number | null;
	cardSpent: number | null;
	cardSpentByCard: { id: string; name: string; amount: number | null }[];
	reserve: number;
	fullDaysLeft: number;
}): CycleView {
	const available = remaining !== null;
	const theoretical = remaining ?? 0;
	const allowance = available
		? Math.round((theoretical - reserve) * 100) / 100
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
	};
}

export interface SafeSpendingConfigHints {
	statementDay: number;
	reserve: number;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
}

export interface BillCandidate {
	id: string;
	name: string;
	amount: number;
}
