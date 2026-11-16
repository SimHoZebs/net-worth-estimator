import type { AccountBalanceRow } from "./generated/model/accountBalanceRow.ts";
import type { BackendPlannedPurchase } from "./contracts.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";
import type { Account, PlannedPurchase } from "../domain/model.ts";

const ACCOUNT_KINDS = new Set(["cash", "investment", "debt", "property"]);

function accountKindOf(kind: string): Account["kind"] {
	return (ACCOUNT_KINDS.has(kind) ? kind : "cash") as Account["kind"];
}

/**
 * Saved balance row as a display account. The row query owns the data: the
 * modeled balance, balance-check presence, sync ownership, and archived state
 * all come from the server. Backend no-bound sentinels count as absent before
 * clamping, so a missing floor shows as zero and a missing ceiling as
 * unbounded. The modeled amount stays the net-worth and projection authority;
 * availableBalance is the bank-reported current figure and stays null when
 * the bank reported none. Current-balance surfaces read the account's display
 * basis (available by default, posted on owner choice), and a reported zero
 * is a real observation rather than missing evidence.
 */
export function balanceRowToDisplay(row: AccountBalanceRow): Account {
	const floor = row.minBalance;
	const ceiling = row.maxBalance;
	return {
		display: row.display
			? { ...row.display, components: row.display.components ?? [] }
			: undefined,
		id: row.id,
		name: row.name || row.id,
		kind: accountKindOf(row.kind),
		enabled: row.enabled,
		archived: row.archived,
		balance: row.componentBalance ?? row.balance,
		minBalance:
			floor === null || floor === NO_FLOOR_SENTINEL || floor < 0 ? 0 : floor,
		maxBalance:
			ceiling === null || ceiling === NO_CEILING_SENTINEL || ceiling < 0
				? null
				: ceiling,
		color: row.color ?? null,
		observedOn: row.observedOn,
		observedAt: row.observedAt ?? null,
		observedBalance: row.observedBalance ?? null,
		availableBalance: row.availableBalance ?? null,
		displayBasis: row.displayBasis === "posted" ? "posted" : "available",
		balanceCheck: row.hasCheckpoint,
		source: row.syncOwned
			? "Synced balance check"
			: row.hasCheckpoint
				? "Balance check"
				: "No balance check",
		readOnly: row.readOnly,
		...(row.institution ? { institution: row.institution } : {}),
		...(row.syncedName ? { syncedName: row.syncedName } : {}),
		...(row.currency ? { currency: row.currency } : {}),
	};
}

/**
 * Standalone planned-purchase row as a display purchase. The server remains
 * the authority on access when each row is saved through its dedicated API.
 */
export function plannedPurchaseRowToDisplay(
	row: BackendPlannedPurchase,
): PlannedPurchase {
	return {
		id: row.id,
		name: row.name || row.id,
		amount: Math.max(0, row.cost),
		fromId: row.fundingAccountId,
		startDate: row.earliestDate,
		enabled: row.enabled,
		readOnly: false,
	};
}
