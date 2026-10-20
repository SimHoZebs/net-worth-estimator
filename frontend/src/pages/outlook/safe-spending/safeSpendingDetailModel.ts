import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import type { MandatorySpendingGroup } from "../../../domain/safeSpending.ts";

export type SafeSpendingDetailTab = "mandatory" | "cycle" | "configure";

export type MandatoryFrame = "calendar" | "cycle";

export interface SafeSpendingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	groups: MandatorySpendingGroup[];
	transactions: AccountTransaction[];
}
export interface CashNowDecomposition {
	checking: number;
	spentSinceStart: number;
	bills: number;
	cushion: number;
	/** Projection-start date anchoring spentSinceStart, for caption context. */
	since: string;
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
	committedTotal: number;
	committedByCard: { id: string; name: string; amount: number }[];
	paycheckAmount: number;
	fixedAmount: number;
	reserveAmount: number;
}

export interface SafeSpendingConfigHints {
	statementDay: number;
	reserve: number;
	spentOverride: number | null;
	paycheckOverride: number | null;
	fixedOverride: number | null;
	checkingOverride: number | null;
	remainingOverride: number | null;
	paycheckHint: { date: string; amount: number } | null;
	fixedHint: { total: number; start: string; end: string };
	checkingHint: number | null;
	remainingHint: { total: number; monthEnd: string };
	spentHint: number;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
}

export interface BillCandidate {
	id: string;
	name: string;
	amount: number;
	frequency: string;
}
