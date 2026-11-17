import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { TransactionResult } from "./result.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { inWindow } from "./safeSpendingMath.ts";
import { resolveEffectiveIds } from "./safeSpendingSelection.ts";

export interface BillCandidate {
	id: string;
	name: string;
	amount: number;
}

/** Bills are the enabled recurring schedules whose source is a selected cash
 * account. The selection of these ids is the only bill selection the UI owns;
 * the backend cash-after-bills window stays a separate financial fact. */
export function billCandidates(
	schedules: readonly Schedule[],
	spendingIds: readonly string[],
): BillCandidate[] {
	const selected = new Set(spendingIds);
	return schedules
		.filter(
			(schedule) =>
				schedule.enabled &&
				schedule.sourceAccountId !== null &&
				selected.has(schedule.sourceAccountId),
		)
		.map((schedule) => ({
			id: schedule.id,
			name: schedule.name || schedule.id,
			amount: literalAmountOf(schedule.amount) ?? 0,
		}));
}

export function effectiveBillIds(
	stored: string[] | null,
	candidates: readonly BillCandidate[],
): string[] {
	return resolveEffectiveIds(
		stored,
		candidates.map((bill) => bill.id),
	);
}

/** Bill occurrences inside the safe card cycle. Posted filtering is the
 * caller's decision: actual rows and projected increases use different sets. */
export function billsInCycle(
	results: readonly TransactionResult[],
	billIds: readonly string[],
	start: string,
	end: string,
): TransactionResult[] {
	const selected = new Set(billIds);
	return results.filter(
		(row) => selected.has(row.transactionId) && inWindow(row.date, start, end),
	);
}
