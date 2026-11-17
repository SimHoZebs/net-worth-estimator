import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { TransactionResult } from "./result.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { inWindow } from "./safeSpendingMath.ts";
import { resolveEffectiveIds } from "./safeSpendingSelection.ts";
import { scheduleOccurrenceDates } from "./scheduleExpansion.ts";

export interface BillCandidate {
	id: string;
	name: string;
	amount: number;
}

/** A bill is a displayable recurring transaction: one with a known positive
 * literal amount. Computed recipes have no amount in this browser-local view,
 * so they are not offered as bills and never reach the Bills list. */
function billAmount(schedule: Schedule): number | null {
	const amount = literalAmountOf(schedule.amount);
	return amount !== null && amount > 0 ? amount : null;
}

/** Bills are the enabled, displayable recurring schedules whose source is a
 * selected cash account. The selection of these ids is the only bill selection
 * the UI owns; the backend cash-after-bills window stays a separate fact. */
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
				selected.has(schedule.sourceAccountId) &&
				billAmount(schedule) !== null,
		)
		.map((schedule) => ({
			id: schedule.id,
			name: schedule.name || schedule.id,
			amount: billAmount(schedule)!,
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

/**
 * The Bills list is the occurrences of the selected schedules in the visible
 * cycle. One row per occurrence of one selected schedule; there is no second
 * source to reconcile, so no dedup is involved.
 */
export function billsInCycle(
	schedules: readonly Schedule[],
	billIds: readonly string[],
	start: string,
	end: string,
): TransactionResult[] {
	const selected = new Set(billIds);
	return schedules
		.filter((schedule) => selected.has(schedule.id))
		.flatMap((schedule) => {
			const amount = billAmount(schedule);
			if (amount === null) return [];
			return scheduleOccurrenceDates({
				startDate: schedule.startDate,
				endDate: schedule.endDate,
				frequency: schedule.frequency,
				through: end,
			})
				.filter((date) => inWindow(date, start, end))
				.map((date) => ({
					date,
					transactionId: schedule.id,
					name: schedule.name || schedule.id,
					requested: amount,
					realized: amount,
					fromId: schedule.sourceAccountId,
					toId: schedule.destinations?.[0] ?? null,
					available: null,
					constraint: null,
					accountDeltas: [],
				}));
		})
		.sort((left, right) =>
			left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
		);
}
