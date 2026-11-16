import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "./model.ts";
import { literalAmountOf } from "./transactionRows.ts";
import { scheduleOccurrenceDates } from "./ruleSchedule.ts";

export interface RecurringBillBump {
	date: string;
	amount: number;
	name?: string;
}

/**
 * Future occurrences of the included recurring bills in (today, cycleEnd].
 * Only the Included bills selection counts, matching the backend outstanding
 * bills scope. Transfer occurrences never count as spending, mirroring the
 * recorded ledger where transfers carry no spending amount. Already claimed
 * occurrences are skipped once.
 */
export function recurringBillBumps({
	schedules,
	transactions,
	trackedBillIds,
	accountIds,
	today,
	cycleEnd,
}: {
	schedules: Schedule[];
	transactions: Transaction[];
	trackedBillIds: string[];
	accountIds?: string[];
	today: string;
	cycleEnd: string;
}): RecurringBillBump[] {
	const start = today.slice(0, 10);
	const end = cycleEnd.slice(0, 10);
	if (!trackedBillIds.length || end < start) return [];
	const tracked = new Set(trackedBillIds);
	const accounts = accountIds ? new Set(accountIds) : null;
	const roundCents = (value: number) => Math.round(value * 100) / 100;

	const claimed = new Set<string>();
	for (const row of transactions) {
		if (row.claimScheduleId && row.claimOccurrenceDate) {
			claimed.add(
				`${row.claimScheduleId}|${row.claimOccurrenceDate.slice(0, 10)}`,
			);
		}
	}

	const byDate = new Map<string, { cents: number; names: string[] }>();
	const add = (date: string, amount: number, name?: string) => {
		if (!Number.isFinite(amount) || amount <= 0) return;
		const day = date.slice(0, 10);
		if (day <= start || day > end) return;
		const entry = byDate.get(day) ?? { cents: 0, names: [] };
		entry.cents += Math.round(amount * 100);
		if (name && !entry.names.includes(name)) entry.names.push(name);
		byDate.set(day, entry);
	};

	for (const schedule of schedules) {
		if (!schedule.enabled) continue;
		if (!tracked.has(schedule.id)) continue;
		if (schedule.sourceAccountId === null) continue;
		if (
			schedule.destinations &&
			schedule.destinations.some((id) => accounts?.has(id))
		)
			continue;
		const each = literalAmountOf(schedule.amount);
		if (each === null || !Number.isFinite(each) || each <= 0) continue;
		const occurrences = scheduleOccurrenceDates({
			startDate: schedule.startDate,
			endDate: schedule.endDate,
			frequency: schedule.frequency,
			through: end,
		});
		for (const date of occurrences) {
			const day = date.slice(0, 10);
			if (day <= start || day > end) continue;
			if (claimed.has(`${schedule.id}|${day}`)) continue;
			add(day, each, schedule.name || schedule.id);
		}
	}

	return [...byDate.entries()]
		.map(([date, entry]) => ({
			date,
			amount: roundCents(entry.cents / 100),
			...(entry.names.length ? { name: entry.names.join(", ") } : {}),
		}))
		.sort((left, right) => (left.date < right.date ? -1 : 1));
}
