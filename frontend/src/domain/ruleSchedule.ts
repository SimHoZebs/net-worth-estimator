import { utcDate } from "./format.ts";

/**
 * Claim candidates from server-provided occurrence dates, ordered by absolute
 * distance to the day the transaction actually happened; ties keep
 * chronological order. Dates another row already claimed are excluded. The
 * row's own selected date is retained at the front when it is no longer in
 * the server list, so an in-progress edit never loses its value.
 */
export function claimOccurrenceCandidates({
	occurrences,
	postedRef,
	claimed,
	ownDate,
}: {
	occurrences: readonly string[];
	postedRef: string;
	claimed: ReadonlySet<string>;
	ownDate?: string | null;
}): string[] {
	const anchor = utcDate(postedRef).getTime();
	const ordered = [...occurrences]
		.filter((date) => !claimed.has(date))
		.sort((a, b) => {
			const distance =
				Math.abs(utcDate(a).getTime() - anchor) -
				Math.abs(utcDate(b).getTime() - anchor);
			if (distance !== 0) return distance;
			return a < b ? -1 : a > b ? 1 : 0;
		});
	if (ownDate && !ordered.includes(ownDate)) return [ownDate, ...ordered];
	return ordered;
}
