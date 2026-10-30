import type { AccountBalanceRow } from "./generated/model/accountBalanceRow.ts";
import type { BackendPlannedPurchase, FinancialModel } from "./contracts.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";
import type { Account, PlannedPurchase } from "../domain/model.ts";

const ACCOUNT_KINDS = new Set(["cash", "investment", "debt", "property"]);

function accountKindOf(kind: string): Account["kind"] {
	return (ACCOUNT_KINDS.has(kind) ? kind : "cash") as Account["kind"];
}

/**
 * Saved balance row as a display account. The row query owns the data: the
 * balance, checkpoint presence, sync ownership, and archived state all come
 * from the server. Backend no-bound sentinels count as absent before
 * clamping, so a missing floor shows as zero and a missing ceiling as
 * unbounded; negative backend bounds clamp the same way.
 */
export function balanceRowToDisplay(row: AccountBalanceRow): Account {
	const floor = row.minBalance;
	const ceiling = row.maxBalance;
	return {
		id: row.id,
		name: row.name || row.id,
		kind: accountKindOf(row.kind),
		enabled: row.enabled,
		archived: row.archived,
		balance: row.balance,
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
		balanceCheck: row.hasCheckpoint,
		source: row.syncOwned
			? "Synced checkpoint"
			: row.hasCheckpoint
				? "Backend checkpoint"
				: "Backend account",
		readOnly: row.readOnly,
	};
}

/**
 * Read standalone saved purchases. Priority orders the queue; model
 * order breaks ties. Purchases never enter the transaction stream.
 */
export function savedPurchasesToDisplay(
	model: FinancialModel | null | undefined,
): PlannedPurchase[] {
	if (!model) return [];
	return [...(model.plannedPurchases ?? [])]
		.sort((left, right) => left.priority - right.priority)
		.map(plannedPurchaseRowToDisplay);
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
