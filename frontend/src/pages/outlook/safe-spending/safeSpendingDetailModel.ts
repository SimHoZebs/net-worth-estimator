import { dateLabel } from "../../../domain/format.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";

export const SAFE_SPENDING_DETAIL_TABS = [
	{ id: "transactions", label: "Transactions", view: "transactions" },
	{ id: "configure", label: "Configure", view: "configure" },
] as const;

export type SafeSpendingDetailTab =
	(typeof SAFE_SPENDING_DETAIL_TABS)[number]["id"];
export type SafeSpendingTransactionsTab = "transactions";

export function isSafeSpendingTransactionsTab(
	tab: SafeSpendingDetailTab,
): tab is SafeSpendingTransactionsTab {
	return SAFE_SPENDING_DETAIL_TABS.some(
		(item) => item.id === tab && item.view === "transactions",
	);
}

/** The server owns both inclusive ends of the active spending cycle. */
export function activeCycleCaption({
	start,
	end,
}: {
	start: string;
	end: string;
}): string {
	return `${dateLabel(start, true)} – ${dateLabel(end, true)}`;
}

export interface ObligationRow {
	id: string;
	name: string;
	date: string;
	amount: number | null;
	/** Status wording for estimated statement rows. */
	detail: string | null;
}

export interface SafeSpendingConfigHints extends Pick<
	SafeSpendingSettings,
	"cycleStartDay" | "paydayDay" | "savingsTarget"
> {
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
}

export type { BillCandidate } from "../../../domain/safeSpendingBills.ts";
