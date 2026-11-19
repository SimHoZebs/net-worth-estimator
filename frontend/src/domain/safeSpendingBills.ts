import type { Schedule } from "@/api/generated/model/schedule.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { resolveEffectiveIds } from "./safeSpendingSelection.ts";

export interface BillCandidate {
	id: string;
	name: string;
	amount: number | null;
}

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
				(!schedule.destinations?.length ||
					schedule.destinations.some((id) => !selected.has(id))),
		)
		.map((schedule) => ({
			id: schedule.id,
			name: schedule.name || schedule.id,
			amount: literalAmountOf(schedule.amount),
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
