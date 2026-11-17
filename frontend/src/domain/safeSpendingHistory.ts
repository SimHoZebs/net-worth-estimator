import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";
import { occurrenceKey } from "./safeSpendingMath.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";
import { literalAmountOf } from "./transactionRows.ts";

/**
 * Posted rows joined to the projection under shared rule identities.
 * Only explicit claims attach a recorded row to a rule; an unclaimed posted
 * outflow stays on its own day. Same-day projected fragments survive because
 * occurrences are keyed by rule, day, route and amount rather than merged.
 */
export function safeSpendingResults({
	transactions,
	projectionTransactions,
	billSchedules = [],
	billWindowStart,
	billWindowEnd,
}: {
	transactions: Transaction[];
	projectionTransactions: TransactionResult[];
	/** Selected recurring schedules, expanded to dated bill occurrences. */
	billSchedules?: readonly Schedule[];
	billWindowStart?: string;
	billWindowEnd?: string;
}): TransactionResult[] {
	const posted: Array<TransactionResult & { postedId?: string }> = [];
	const claimedKeys = new Set<string>();
	for (const row of transactions) {
		if (row.kind !== "transaction" || !row.enabled || row.void || row.pending)
			continue;
		if (!row.startDate) continue;
		const transactionId = row.claimScheduleId ?? row.id;
		// The claim names the guessed occurrence the row fulfills; the row
		// itself happens when it happened.
		const claimDate = row.claimOccurrenceDate;
		if (row.claimScheduleId && claimDate)
			claimedKeys.add(occurrenceKey(transactionId, claimDate));
		posted.push({
			date: row.startDate,
			transactionId,
			name: row.name,
			requested: row.amount,
			realized: row.amount,
			fromId: row.fromId,
			toId: row.toId,
			available: null,
			constraint: null,
			accountDeltas: [],
			posted: true,
			claimed: row.claimScheduleId !== null,
			postedId: row.id,
		});
	}

	const combined: TransactionResult[] = [];
	const seen = new Set<string>();
	const add = (row: TransactionResult) => {
		const key = occurrenceKey(row.transactionId, row.date);
		const identity = `${key}|${row.fromId}|${row.toId}|${row.requested}`;
		if (seen.has(identity)) return;
		seen.add(identity);
		combined.push(row);
	};
	// Posted deposits are distinct evidence: keep each even when two share
	// the same attached rule, day, and amount. Track their occurrences
	// separately so projected fragments for unposted occurrences survive.
	const postedOccurrences = new Set<string>();
	for (const row of posted) {
		combined.push(row);
		postedOccurrences.add(occurrenceKey(row.transactionId, row.date));
	}
	for (const row of projectionTransactions) {
		if (claimedKeys.has(occurrenceKey(row.transactionId, row.date))) continue;
		if (postedOccurrences.has(occurrenceKey(row.transactionId, row.date)))
			continue;
		add(row);
	}
	// The projection does not carry schedule occurrences that already settled,
	// so the selected bills are expanded here. A claimed occurrence is already
	// represented by its posted row and must not be duplicated.
	if (
		billWindowStart !== undefined &&
		billWindowEnd !== undefined &&
		billSchedules.length > 0
	) {
		for (const schedule of billSchedules) {
			if (!schedule.enabled) continue;
			const amount = literalAmountOf(schedule.amount);
			if (amount === null || amount <= 0) continue;
			for (const date of scheduleOccurrenceDates({
				startDate: schedule.startDate,
				endDate: schedule.endDate,
				frequency: schedule.frequency,
				through: billWindowEnd,
			})) {
				if (date < billWindowStart) continue;
				if (claimedKeys.has(occurrenceKey(schedule.id, date))) continue;
				if (postedOccurrences.has(occurrenceKey(schedule.id, date))) continue;
				add({
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
				});
			}
		}
	}
	return combined;
}
