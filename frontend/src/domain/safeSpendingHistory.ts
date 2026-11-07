import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";

/**
 * Posted rows joined to the projection under shared rule identities.
 * Historical bills before the projection start come from the one-time
 * schedule fill until the server exposes historical occurrences.
 */
export function safeSpendingResults({
	transactions,
	projectionTransactions,
	schedules = [],
	billScheduleIds = [],
	billWindowStart,
	billWindowEnd,
}: {
	transactions: Transaction[];
	projectionTransactions: TransactionResult[];
	schedules?: import("@/api/generated/model/schedule.ts").Schedule[];
	billScheduleIds?: string[];
	billWindowStart?: string;
	billWindowEnd?: string;
}): TransactionResult[] {
	const posted: TransactionResult[] = [];
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
			claimedKeys.add(`${transactionId}|${claimDate}`);
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
		});
	}

	const combined: TransactionResult[] = [];
	const seen = new Set<string>();
	const existing = new Set<string>();
	// A claimed guess stays taken even though the fulfilling row shows its
	// own day: the server fill must not resurrect it.
	for (const key of claimedKeys) existing.add(key);
	const add = (row: TransactionResult) => {
		const occurrenceKey = `${row.transactionId}|${row.date}`;
		const key = `${occurrenceKey}|${row.fromId}|${row.toId}|${row.requested}`;
		if (seen.has(key)) return;
		seen.add(key);
		existing.add(occurrenceKey);
		combined.push(row);
	};
	for (const row of posted) add(row);
	for (const row of projectionTransactions) {
		if (claimedKeys.has(`${row.transactionId}|${row.date}`)) continue;
		add(row);
	}
	if (billWindowStart !== undefined && billWindowEnd !== undefined && schedules.length > 0 && billScheduleIds.length > 0) {
		const selected = new Set(billScheduleIds);
		for (const schedule of schedules) {
			if (!schedule.enabled || !selected.has(schedule.id)) continue;
			const amount = literalAmountOf(schedule.amount);
			if (amount === null || amount <= 0) continue;
			for (const date of scheduleOccurrenceDates({
				startDate: schedule.startDate,
				endDate: schedule.endDate,
				frequency: schedule.frequency,
				through: billWindowEnd,
			})) {
				if (date < billWindowStart) continue;
				if (existing.has(`${schedule.id}|${date}`)) continue;
				const row: TransactionResult = {
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
				};
				add(row);
			}
		}
	}
	return combined;
}

/**
 * Obligations are the selected bill rules plus projected one-time rows.
 * A posted outflow without a claim stays in the cash stream. No near-match
 * grouping: amounts never merge rows, so a distinct same-day outflow
 * always survives alongside a projected bill.
 */
export function selectObligationResults(
	results: TransactionResult[],
	transactionIds: string[] | null,
): TransactionResult[] {
	if (transactionIds) {
		const selected = new Set(transactionIds);
		return results.filter((row) => selected.has(row.transactionId));
	}
	return results;
}
