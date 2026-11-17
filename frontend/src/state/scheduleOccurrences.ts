import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listScheduleOccurrences } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { claimOccurrenceCandidates } from "../domain/ruleSchedule.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useSavedTransactions } from "./savedState.ts";
import { useUserScope } from "./useUserScope.ts";

export const scheduleOccurrencesKey = (
	scheduleId: string,
	scope = getUserScope(),
) => ["schedule-occurrences", scope.key, scheduleId] as const;

/**
 * Server-provided occurrence dates for one schedule. The `through` query
 * parameter is omitted so the server default horizon applies (3 calendar
 * months after today UTC).
 * Note: a post-dated happened day beyond that horizon has no server date to
 * claim; pass an explicit `through` to the endpoint when that escape hatch
 * is needed.
 */
export function useScheduleOccurrences(scheduleId: string | null | undefined) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: scheduleOccurrencesKey(scheduleId ?? "", scope),
			enabled: Boolean(scheduleId) && scope.status === "ready",
			queryFn: async ({ signal }) =>
				(await listScheduleOccurrences(scheduleId!, undefined, { signal }))
					.data,
		},
		serverQueryClient(),
	);
}

/**
 * Claim options for one schedule: server occurrences excluding dates already
 * claimed by other rows, ordered by distance to the happened day with
 * chronological tiebreak. The row's own selected date stays at the front.
 */
export function useClaimOccurrenceOptions({
	scheduleId,
	happenedDay,
	currentTransactionId,
	selectedDate,
}: {
	scheduleId: string | null | undefined;
	happenedDay: string;
	currentTransactionId?: string | null;
	selectedDate?: string | null;
}): string[] {
	const occurrencesQuery = useScheduleOccurrences(scheduleId);
	const savedTransactions = useSavedTransactions();
	return useMemo(() => {
		if (!scheduleId) return [];
		const claimed = new Set<string>();
		for (const row of savedTransactions ?? []) {
			if (
				row.id !== currentTransactionId &&
				row.claimScheduleId === scheduleId &&
				row.claimOccurrenceDate
			)
				claimed.add(row.claimOccurrenceDate);
		}
		if (selectedDate) claimed.delete(selectedDate);
		return claimOccurrenceCandidates({
			occurrences: occurrencesQuery.data?.occurrences ?? [],
			postedRef: happenedDay,
			claimed,
			ownDate: selectedDate,
		});
	}, [
		scheduleId,
		happenedDay,
		currentTransactionId,
		selectedDate,
		savedTransactions,
		occurrencesQuery.data?.occurrences,
	]);
}
