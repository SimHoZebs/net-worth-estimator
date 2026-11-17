import { transactionCategoryLabels } from "./categories.ts";

interface AmountRow {
	spendingAmount?: number | null;
	amount?: number | null;
}

/** Reads `spendingAmount ?? amount` without requiring a specific row type. */
const spendingAmountOf = (row: unknown): number | null | undefined => {
	const candidate = row as AmountRow;
	return candidate.spendingAmount ?? candidate.amount;
};

export const roundCents = (value: number): number =>
	Math.round(value * 100) / 100;

/** Sum of round-to-cents amounts. Rows with no finite amount contribute zero. */
export function sumCents<T>(
	rows: readonly T[],
	amountOf: (row: T) => number | null | undefined = spendingAmountOf,
): number {
	let cents = 0;
	for (const row of rows) {
		const amount = amountOf(row);
		if (typeof amount === "number" && Number.isFinite(amount))
			cents += Math.round(amount * 100);
	}
	return roundCents(cents / 100);
}

export function hasUnknownSpending<
	T extends { spendingAmountUnknown?: boolean },
>(rows: readonly T[]): boolean {
	return rows.some((row) => row.spendingAmountUnknown);
}

/** Inclusive comparison of the calendar-day parts of ISO dates. */
export function inWindow(date: string, start: string, end: string): boolean {
	const day = date.slice(0, 10);
	return day >= start.slice(0, 10) && day <= end.slice(0, 10);
}

/** Stable identity for one rule occurrence, shared by join and dedupe paths. */
export function occurrenceKey(transactionId: string, date: string): string {
	return `${transactionId}|${date}`;
}

/** A known, non-income, non-transfer transaction category counts as spending. */
export function isSpendCategory(category: string | null | undefined): boolean {
	return (
		category !== undefined &&
		category !== null &&
		Object.hasOwn(transactionCategoryLabels, category) &&
		category !== "INCOME" &&
		category !== "TRANSFER_IN" &&
		category !== "TRANSFER_OUT"
	);
}

/** Group rows by calendar day, summing cents and collecting distinct names. */
export function groupByDate<T extends { date: string }>(
	rows: readonly T[],
	amountOf: (row: T) => number | null | undefined,
	nameOf?: (row: T) => string | null | undefined,
): Array<{ date: string; amount: number; name?: string }> {
	const grouped = new Map<string, { cents: number; names: string[] }>();
	for (const row of rows) {
		const amount = amountOf(row);
		if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
		const day = row.date.slice(0, 10);
		const entry = grouped.get(day) ?? { cents: 0, names: [] as string[] };
		entry.cents += Math.round(amount * 100);
		const name = nameOf?.(row);
		if (name && !entry.names.includes(name)) entry.names.push(name);
		grouped.set(day, entry);
	}
	return [...grouped.entries()]
		.map(([date, entry]) => ({
			date,
			amount: roundCents(entry.cents / 100),
			...(entry.names.length ? { name: entry.names.join(", ") } : {}),
		}))
		.sort((left, right) => (left.date < right.date ? -1 : 1));
}
