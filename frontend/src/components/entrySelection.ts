import { useState } from "react";
import type { AccountTransaction } from "../domain/accountActivity.ts";

/** Projected row ids include a list index, not just occurrence identity. */
export function transactionSelectionKey(
	transaction: AccountTransaction,
): string {
	return transaction.source === "historical"
		? transaction.id
		: JSON.stringify([transaction.transactionId, transaction.date]);
}

/** Single holder for a selected id. The id is local identity, never a copy
 * of financial records: callers resolve it against current records each
 * render (a missing id renders as no selection, so deletion closes without
 * synchronization), and clear it on explicit dismissal.
 * A genuinely different scope (another evaluation) remounts through the
 * list `key`, so no reset identity is needed here. */
export function useSelectedId(
	initial: string | null = null,
): [string | null, (id: string | null) => void] {
	return useState<string | null>(initial);
}

/** Same holder for simple presence flags. Prefer ids resolved from current
 * records wherever a record exists; keep this for selections with no
 * record to resolve (for example an inspector opened for an analysis). */
export function useSelectedEntry<T>(
	initial: T | null = null,
): [T | null, (entry: T | null) => void] {
	return useState<T | null>(initial);
}
