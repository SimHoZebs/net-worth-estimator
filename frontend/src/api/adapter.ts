import type { AccountBalanceRow } from "./generated/model/accountBalanceRow.ts";
import type { TransactionRow } from "./generated/model/transactionRow.ts";
import type {
	BackendPlannedPurchase,
	BackendPosting,
	FinancialModelDocument,
} from "./contracts.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";
import { literalAmountOf } from "../domain/transactionRows.ts";
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
 * Narrow saved-purchase reader over one document, not an aggregate. The
 * backend still persists wishlist rows as postings with a purchase marker,
 * while the compute contract already describes standalone planned-purchase
 * rows; this reads both. Standalone rows are canonical and win the
 * deterministic dedupe when both forms carry the same id. Legacy costs come
 * from the stored literal expression (clamped like standalone costs, never
 * dropped) and the earliest date from the transaction stamp. Rows sort by
 * priority; document order breaks ties.
 */
export function savedPurchasesToDisplay(
	document: FinancialModelDocument | null | undefined,
): PlannedPurchase[] {
	if (!document) return [];
	const entries: { purchase: PlannedPurchase; priority: number }[] = [];
	const seen = new Set<string>();
	for (const row of document.plannedPurchases ?? []) {
		seen.add(row.id);
		entries.push({
			purchase: plannedPurchaseRowToDisplay(row),
			priority: row.priority,
		});
	}
	for (const posting of document.postings ?? []) {
		if (!posting.purchase || seen.has(posting.id)) continue;
		seen.add(posting.id);
		entries.push({
			purchase: purchasePostingToDisplay(posting),
			priority: posting.purchase.priority,
		});
	}
	return entries
		.sort((left, right) => left.priority - right.priority)
		.map((entry) => entry.purchase);
}

/** Legacy purchase-marker posting as a display purchase. */
function purchasePostingToDisplay(posting: BackendPosting): PlannedPurchase {
	const stamp =
		posting.transactionTime > 0
			? posting.transactionTime
			: posting.postedTime > 0
				? posting.postedTime
				: 0;
	return {
		id: posting.id,
		name: posting.name || posting.id,
		// The hand-written contract marks inputs optional while the
		// generated row requires the key; the wire shape is identical.
		amount: Math.max(
			0,
			literalAmountOf(posting.amount as TransactionRow["amount"]) ?? 0,
		),
		fromId: posting.sourceAccountId,
		startDate: new Date(stamp * 1000).toISOString().slice(0, 10),
		enabled: posting.enabled,
		readOnly: false,
	};
}

/**
 * Standalone planned-purchase row as a display purchase. The canonical
 * document owns these rows; there is no row API for them yet. The document
 * carries no per-row access policy, so display rows start editable and the
 * server remains the authority on save.
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
