import type { Schedule } from "@/api/generated/model/schedule.ts";
import { literalAmountOf } from "./transactionRows.ts";
import type { Transaction } from "./model.ts";
import type { TransactionResult } from "./result.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";

/**
 * Posted rows joined to the projection under shared rule identities.
 * Claimed postings keep their schedule id; the claim names the guessed
 * occurrence it fulfills, and that guess drops out of the stream, so the
 * row shows the day it happened. Posted income maps to the selected source
 * with the matching amount, and selected bills with no posted or projected
 * occurrence in the window get their scheduled occurrence. The open and
 * closed tabs read the same stream.
 */
export function safeSpendingResults({
	transactions,
	rules,
	schedules,
	incomeAccountIds,
	incomeScheduleIds,
	billScheduleIds,
	billWindowStart,
	billWindowEnd,
	projectionTransactions,
}: {
	transactions: Transaction[];
	rules: Transaction[];
	schedules: Schedule[];
	incomeAccountIds: string[];
	incomeScheduleIds: string[];
	billScheduleIds: string[];
	billWindowStart: string;
	billWindowEnd: string;
	projectionTransactions: TransactionResult[];
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
		const closest = candidates.reduce((left, right) => {
			const leftAmount = amountOf(left);
			const rightAmount = amountOf(right);
			if (leftAmount === null) return right;
			if (rightAmount === null) return left;
			return Math.abs(row.amount - leftAmount) <=
				Math.abs(row.amount - rightAmount)
				? left
				: right;
		});
		const reference = amountOf(closest);
		if (reference === null) return null;
		return Math.abs(row.amount - reference) <= Math.max(100, reference * 0.15)
			? closest.id
			: null;
	};

	const posted: TransactionResult[] = [];
	const claimedKeys = new Set<string>();
	for (const row of transactions) {
		if (row.kind !== "posting" || !row.enabled || row.void || row.pending)
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
		});
	}

	const combined: TransactionResult[] = [];
	const seen = new Set<string>();
	const existing = new Set<string>();
	// A claimed guess stays taken even though the fulfilling row shows its
	// own day: the synthetic fill must not resurrect it.
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
	const selectedBills = new Set(billScheduleIds);
	const synthetic: TransactionResult[] = [];
	for (const schedule of schedules) {
		if (!schedule.enabled || !selectedBills.has(schedule.id)) continue;
		const amount = literalAmountOf(schedule.amount);
		if (amount === null || amount <= 0) continue;
		for (const date of scheduleOccurrenceDates({
			startDate: schedule.startDate,
			endDate: schedule.endDate,
			frequency: schedule.frequency,
			through: billWindowEnd,
		})) {
			if (date < billWindowStart) continue;
			const key = `${schedule.id}|${date}`;
			if (existing.has(key)) continue;
			existing.add(key);
			synthetic.push({
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
	return [...combined, ...synthetic];
}

/**
 * Obligations are the selected bill rules plus projected one-time rows.
 * A posted outflow without a claim stays in the cash stream. When no bill
 * selection exists, it is still a one-time obligation unless a projected
 * bill rule already represents the same date, source, and amount within a
 * near-match tolerance. Counting both would double-charge the same bill,
 * while a distinct same-day outflow survives.
 */
export function selectObligationResults(
	results: TransactionResult[],
	transactionIds: string[] | null,
	billScheduleIds: string[] = [],
): TransactionResult[] {
	if (transactionIds) {
		const selected = new Set(transactionIds);
		return results.filter((row) => selected.has(row.transactionId));
	}
	const billIds = new Set(billScheduleIds);
	const projectedBills = results.filter(
		(row) => !row.posted && billIds.has(row.transactionId),
	);
	return results.filter((row) => {
		if (!row.posted || row.claimed === true) return true;
		return !projectedBills.some(
			(bill) =>
				bill.date === row.date &&
				bill.fromId === row.fromId &&
				Math.abs(bill.requested - row.requested) <=
					Math.max(100, bill.requested * 0.1),
		);
	});
}
