import { dateLabel } from "../../../domain/format.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";

export const SAFE_SPENDING_DETAIL_TABS = [
	{ id: "ledger", label: "Obligations", view: "ledger" },
	{ id: "configure", label: "Configure", view: "configure" },
] as const;

export type SafeSpendingDetailTab =
	(typeof SAFE_SPENDING_DETAIL_TABS)[number]["id"];
export type SafeSpendingLedgerTab = "ledger";

export function isSafeSpendingLedgerTab(
	tab: SafeSpendingDetailTab,
): tab is SafeSpendingLedgerTab {
	return SAFE_SPENDING_DETAIL_TABS.some(
		(item) => item.id === tab && item.view === "ledger",
	);
}

/** The next income date is independent from the configured card payoff date. */
export function allowanceCaption({
	payday,
	cashAsOf,
}: {
	payday: string | null;
	cashAsOf: string;
}): string {
	return payday
		? `Next income · ${dateLabel(payday, true)}`
		: `As of ${dateLabel(cashAsOf, true)}`;
}

export type EvidenceStatus = "available" | "uncertain" | "missing";

export interface ObligationRow {
	id: string;
	name: string;
	date: string;
	amount: number | null;
	/** Status wording for estimated statement rows. */
	detail: string | null;
}

export interface ObligationSection {
	title: string;
	/** Server-owned total for this part of the protected ledger. */
	total: number | null;
	rows: ObligationRow[];
}

export interface DatedAllowance {
	cashAsOf: string;
	payday: string | null;
	status: EvidenceStatus;
	prePaydayRoom: number | null;
	postIncomeRoom: number | null;
	paymentRoom: number | null;
	expectedPay: number | null;
	reserve: number;
}

export interface AllowanceEvidence {
	status: EvidenceStatus;
	checkingAvailable: number | null;
	cashAsOf: string;
	baselines: {
		accountId: string;
		accountName: string;
		basis: string;
		status: string;
		amount: number | null;
	}[];
}

export interface AllowanceLedger {
	allowance: DatedAllowance;
	sections: ObligationSection[];
	evidence: AllowanceEvidence;
	/** Server-owned obligation totals combined for the one-line preview summary. */
	protectedTotal: number | null;
	obligationCount: number;
}

export interface SafeSpendingConfigHints extends Pick<
	SafeSpendingSettings,
	"reserve" | "cycleStartDay" | "paydayDay" | "savingsTarget"
> {
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
}

export type { BillCandidate } from "../../../domain/safeSpendingBills.ts";
