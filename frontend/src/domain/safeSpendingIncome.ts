import { literalAmountOf } from "./transactionRows.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";
import type { Account, Transaction } from "./model.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";

/** Explicit recurring inflows into the configured cash accounts. Future
 * starts remain selectable; payment eligibility is decided from posted facts. */
export function incomeSourceCandidates({
	accounts,
	rules,
	spendingIds,
	incomeScheduleIds = [],
	today,
}: {
	accounts: Account[];
	rules: Transaction[];
	spendingIds: string[];
	incomeScheduleIds?: string[];
	today: string;
}): Transaction[] {
	const available = new Set(
		accounts
			.filter((account) => account.enabled && !account.archived)
			.map((account) => account.id),
	);
	const destinations = new Set(
		spendingIds.filter((id) => available.has(id)),
	);
	const selected = new Set(incomeScheduleIds);
	return rules.filter(
		(rule) =>
			rule.kind === "schedule" &&
			(selected.has(rule.id) ||
				(rule.enabled && (rule.endDate === null || rule.endDate >= today))) &&
			rule.toId !== null &&
			destinations.has(rule.toId) &&
			rule.fromId === null,
	);
}

/** Expected pay for the calendar month from the selected recurring sources,
 * including an end-of-month paycheck that falls outside the statement cycle.
 * Scheduled occurrences in [monthStart, monthEnd] each contribute the
 * source's resolved amount. Returns null when no source is selected or an
 * expected amount cannot be resolved; a selected source with no occurrence
 * this month contributes nothing. */
export function expectedMonthlyIncome({
	schedules,
	incomeScheduleIds,
	monthStart,
	monthEnd,
}: {
	schedules: Schedule[];
	incomeScheduleIds: string[];
	monthStart: string;
	monthEnd: string;
}): number | null {
	if (!incomeScheduleIds.length) return null;
	const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
	let cents = 0;
	let counted = false;
	for (const id of new Set(incomeScheduleIds)) {
		const schedule = byId.get(id);
		if (!schedule) return null;
		const occurrences = scheduleOccurrenceDates({
			startDate: schedule.startDate,
			endDate: schedule.endDate,
			frequency: schedule.frequency,
			through: monthEnd,
		}).filter((date) => date >= monthStart);
		if (!occurrences.length) continue;
		const each = literalAmountOf(schedule.amount);
		if (each === null || !Number.isFinite(each)) return null;
		counted = true;
		cents += Math.round(each * 100) * occurrences.length;
	}
	return counted ? cents / 100 : 0;
}
