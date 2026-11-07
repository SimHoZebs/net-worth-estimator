import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";

/**
 * Posted rows joined to the projection under shared rule identities.
 * Posted income attaches to the closest selected income rule when no
 * explicit claim names it. Historical bills come from the one-time
 * schedule fill until the server exposes historical occurrences.
 */
export function safeSpendingResults({
	transactions,
	projectionTransactions,
	schedules = [],
	billScheduleIds = [],
	billWindowStart,
	billWindowEnd,
	rules = [],
	incomeAccountIds = [],
	incomeScheduleIds = [],
}: {
	transactions: Transaction[];
	projectionTransactions: TransactionResult[];
	schedules?: import("@/api/generated/model/schedule.ts").Schedule[];
	billScheduleIds?: string[];
	billWindowStart?: string;
	billWindowEnd?: string;
	rules?: Transaction[];
	incomeAccountIds?: string[];
	incomeScheduleIds?: string[];
}): TransactionResult[] {
	const incomeAccounts = new Set(incomeAccountIds);
	const selectedIncome = new Set(incomeScheduleIds);
	const incomeRules = rules.filter(
		(rule) => rule.kind === "schedule" && selectedIncome.has(rule.id),
	);
	const expectedIncome = new Map<string, number>();
	for (const transaction of projectionTransactions) {
		if (!selectedIncome.has(transaction.transactionId)) continue;
		if (transaction.requested <= 0) continue;
		if (!expectedIncome.has(transaction.transactionId)) {
			expectedIncome.set(transaction.transactionId, transaction.requested);
		}
	}
	const incomeRuleFor = (row: Transaction): string | null => {
		if (row.amount <= 0 || row.toId === null) return null;
		if (!incomeAccounts.has(row.toId)) return null;
		if (row.fromId !== null && incomeAccounts.has(row.fromId)) return null;
		const candidates = incomeRules.filter((rule) => rule.toId === row.toId);
		if (candidates.length === 0) return null;
		const amountOf = (rule: Transaction) =>
			expectedIncome.get(rule.id) ?? (rule.amount > 0 ? rule.amount : null);
		const scored = candidates
			.map((rule) => ({ rule, amount: amountOf(rule) }))
			.filter(
				(entry): entry is { rule: Transaction; amount: number } =>
					entry.amount !== null,
			);
		if (scored.length === 0) return null;
		const closestDistance = Math.min(
			...scored.map(({ amount }) => Math.abs(row.amount - amount)),
		);
		const closest = scored.filter(
			({ amount }) => Math.abs(row.amount - amount) === closestDistance,
		);
		const closestEntry = closest[0];
		if (!closestEntry || closest.length !== 1) return null;
		const reference = closestEntry.amount;
		return Math.abs(row.amount - reference) <= Math.max(100, reference * 0.15)
			? closestEntry.rule.id
			: null;
	};
	const posted: Array<TransactionResult & { postedId?: string }> = [];
	const claimedKeys = new Set<string>();
	for (const row of transactions) {
		if (row.kind !== "transaction" || !row.enabled || row.void || row.pending)
			continue;
		if (!row.startDate) continue;
		const transactionId = row.claimScheduleId ?? incomeRuleFor(row) ?? row.id;
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
			postedId: row.id,
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
	// Posted deposits are distinct evidence: keep each even when two share
	// the same attached rule, day, and amount. Track their occurrences
	// separately so projected fragments for unposted occurrences survive.
	const postedOccurrences = new Set<string>();
	for (const row of posted) {
		combined.push(row);
		postedOccurrences.add(`${row.transactionId}|${row.date}`);
	}
	for (const row of projectionTransactions) {
		if (claimedKeys.has(`${row.transactionId}|${row.date}`)) continue;
		if (postedOccurrences.has(`${row.transactionId}|${row.date}`)) continue;
		add(row);
	}
	for (const key of postedOccurrences) existing.add(key);
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
