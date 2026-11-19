import { isIsoDate } from "./format.ts";
import {
	recurrenceFromFrequency,
	recurrenceOccurrenceDates,
	type Recurrence,
} from "./recurrence.ts";

/**
 * Scheduled occurrence dates of a schedule from its start date
 * through `through` (inclusive), never past the schedule's own end date.
 * An open-ended schedule stops at `through`.
 * Projection-only helper: the claim UI reads occurrences from the server
 * endpoint instead of expanding dates locally.
 */
export function scheduleOccurrenceDates({
	startDate,
	endDate,
	frequency,
	recurrence,
	through,
}: {
	startDate: string;
	endDate: string | null;
	/**
	 * @deprecated Replaced by `recurrence`. Kept for transitional server
	 * rows that still carry a legacy frequency string.
	 */
	frequency?: string;
	recurrence?: Recurrence;
	through: string;
}): string[] {
	if (!isIsoDate(startDate)) return [];
	const resolved =
		recurrence ??
		(frequency !== undefined
			? recurrenceFromFrequency(frequency, startDate)
			: undefined);
	if (!resolved) return [];
	return recurrenceOccurrenceDates({
		startDate,
		recurrence: resolved,
		endDate,
		through,
	});
}
