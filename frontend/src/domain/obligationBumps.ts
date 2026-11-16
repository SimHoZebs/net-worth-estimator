import type { SafeSpendingObligation } from "@/api/generated/model/safeSpendingObligation.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "./model.ts";

export interface ObligationBump {
	date: string;
	amount: number;
	name?: string;
}

/**
 * Projected steps read from the backend outstanding bills, the same rows the
 * Bills section lists. No schedule expansion happens here: dates and amounts
 * come solely from the cash summary, so every bump has a matching Bills row.
 * Transfers carry no spending and never step the line; only their destination
 * lookup touches schedules and transactions. Already claimed occurrences stay
 * out because the payment is recorded in actual spending.
 */
export function obligationBumps({
	obligations,
	schedules,
	transactions,
	accountIds,
	today,
	cycleEnd,
}: {
	obligations: readonly SafeSpendingObligation[];
	schedules: readonly Schedule[];
	transactions: readonly Transaction[];
	accountIds: readonly string[];
	today: string;
	cycleEnd: string;
}): ObligationBump[] {
	const start = today.slice(0, 10);
	const end = cycleEnd.slice(0, 10);
	if (end < start) return [];
	const accounts = new Set(accountIds);
	const schedulesById = new Map(
		schedules.map((schedule) => [schedule.id, schedule]),
	);
	const transactionsById = new Map(
		transactions.map((transaction) => [transaction.id, transaction]),
	);
	const claimed = new Set<string>();
	for (const row of transactions) {
		if (row.claimScheduleId && row.claimOccurrenceDate) {
			claimed.add(
				`${row.claimScheduleId}|${row.claimOccurrenceDate.slice(0, 10)}`,
			);
		}
	}

	const byDate = new Map<string, { cents: number; names: string[] }>();
	for (const row of obligations) {
		const day = row.date.slice(0, 10);
		if (day <= start || day > end) continue;
		if (row.amount === null || !Number.isFinite(row.amount) || row.amount <= 0)
			continue;
		if (row.scheduleId && claimed.has(`${row.scheduleId}|${day}`)) continue;
		const destinations: (string | null)[] = row.scheduleId
			? (schedulesById.get(row.scheduleId)?.destinations ?? [])
			: [
					row.transactionId
						? (transactionsById.get(row.transactionId)?.toId ?? null)
						: null,
				];
		if (destinations.some((id) => id !== null && accounts.has(id))) continue;
		const entry = byDate.get(day) ?? { cents: 0, names: [] };
		entry.cents += Math.round(row.amount * 100);
		if (row.name && !entry.names.includes(row.name)) entry.names.push(row.name);
		byDate.set(day, entry);
	}

	const roundCents = (value: number) => Math.round(value * 100) / 100;
	return [...byDate.entries()]
		.map(([date, entry]) => ({
			date,
			amount: roundCents(entry.cents / 100),
			...(entry.names.length ? { name: entry.names.join(", ") } : {}),
		}))
		.sort((left, right) => (left.date < right.date ? -1 : 1));
}
