import { isIsoDate } from "./format.ts";
import { addMonthsClamped } from "./subscriptions.ts";

/**
 * Scheduled occurrence dates of a recurrence rule from its start date
 * through `through` (inclusive), never past the rule's own end date.
 * The window to today is the claimable range: a posting exists in the
 * past or today, so only occurrences scheduled by then are offered.
 * An open-ended rule stops at `through`.
 */
export function ruleOccurrenceDates({
	startDate,
	endDate,
	frequency,
	through,
}: {
	startDate: string;
	endDate: string | null;
	frequency: string;
	through: string;
}): string[] {
	const effectiveEnd = endDate !== null && endDate < through ? endDate : through;
	if (!isIsoDate(startDate) || startDate > effectiveEnd) return [];
	const dates: string[] = [];
	for (let count = 0; ; count += 1) {
		const date = advanceOccurrence(startDate, frequency, count);
		if (date === null || date > effectiveEnd) return dates;
		dates.push(date);
	}
}

/**
 * Claim candidates for one rule, ordered by absolute distance to the day
 * the posting actually happened; ties keep chronological order. Dates
 * another row already claimed for this rule are excluded.
 */
export function claimOccurrenceCandidates({
	rule,
	through,
	postedRef,
	claimed,
}: {
	rule: { startDate: string; endDate: string | null; frequency: string };
	through: string;
	postedRef: string;
	claimed: ReadonlySet<string>;
}): string[] {
	const anchor = Date.parse(`${postedRef}T00:00:00Z`);
	return ruleOccurrenceDates({ ...rule, through })
		.filter((date) => !claimed.has(date))
		.sort((a, b) => {
			const distance =
				Math.abs(Date.parse(`${a}T00:00:00Z`) - anchor) -
				Math.abs(Date.parse(`${b}T00:00:00Z`) - anchor);
			if (distance !== 0) return distance;
			return a < b ? -1 : a > b ? 1 : 0;
		});
}

function advanceOccurrence(
	startDate: string,
	frequency: string,
	count: number,
): string | null {
	switch (frequency) {
		case "daily":
			return addDays(startDate, count);
		case "weekly":
			return addDays(startDate, count * 7);
		case "monthly":
			return addMonthsClamped(startDate, count);
		case "quarterly":
			return addMonthsClamped(startDate, count * 3);
		case "annual":
			return addMonthsClamped(startDate, count * 12);
		default:
			return null;
	}
}

function addDays(date: string, days: number): string {
	const stamp = Date.parse(`${date}T00:00:00Z`);
	return new Date(stamp + days * 86400000).toISOString().slice(0, 10);
}
