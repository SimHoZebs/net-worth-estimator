import { queryOptions, useIsMutating, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getSafeSpendingSummary } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { isoDate, shiftDate, utcDate } from "@/domain/format.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";
import {
	getSafeSpendingSettings,
	safeSpendingSettingsKey,
} from "./useSafeSpendingSettings.ts";
import {
	useAccountBalances,
	useTransactions,
	useSchedules,
	userResourceKey,
} from "./workspaceResources.ts";

function nextUtcMidnight(timestamp: number): number {
	const tomorrow = shiftDate({ date: isoDate(new Date(timestamp)), days: 1 });
	return utcDate(tomorrow).setUTCHours(0);
}

/**
 * One coherent read of the server-owned before-payday summary. The endpoint
 * owns the date, obligations and calculation, so the key carries only the
 * model revisions and the effective settings that can change its answer.
 */
export function safeSpendingSummaryOptions(
	revisions: readonly (string | null | undefined)[],
	scope = getUserScope(),
) {
	return queryOptions({
		queryKey: [
			...userResourceKey("safe-spending-summary", scope),
			...revisions,
			getSafeSpendingSettings(scope),
		],
		queryFn: async ({ signal }) =>
			(await getSafeSpendingSummary({ signal, cache: "no-store" })).data,
		staleTime: ({ state }) =>
			nextUtcMidnight(state.dataUpdatedAt) - state.dataUpdatedAt,
		refetchInterval: () => {
			const now = Date.now();
			return nextUtcMidnight(now) - now;
		},
		refetchOnWindowFocus: true,
		retry: false,
	});
}

export function useSafeSpendingSummary() {
	const scope = useUserScope();
	const savingSettings =
		useIsMutating(
			{ mutationKey: safeSpendingSettingsKey(scope) },
			serverQueryClient(),
		) > 0;
	const balances = useAccountBalances();
	const transactions = useTransactions();
	const schedules = useSchedules();
	const revisions = [
		balances.data?.revision,
		transactions.data?.revision,
		schedules.data?.revision,
	];
	const coherent = revisions.every(
		(revision) => revision != null && revision === revisions[0],
	);
	const expectedRevision = revisions[0];
	const revisionsKey = revisions.join("|");
	const loaded = revisions.every((revision) => revision != null);
	const query = useQuery(
		{
			...safeSpendingSummaryOptions(revisions, scope),
			enabled: scope.status === "ready" && coherent && !savingSettings,
		},
		serverQueryClient(),
	);
	const canUseData =
		coherent &&
		!savingSettings &&
		!query.isError &&
		query.data?.revision === expectedRevision;
	const summaryRevision = query.data?.revision;
	useEffect(() => {
		if (
			!loaded ||
			(coherent && (!summaryRevision || summaryRevision === expectedRevision))
		)
			return;
		const cache = serverQueryClient();
		for (const kind of [
			"balances",
			"transactions",
			"rules",
			"checkpoints",
		] as const)
			void cache.invalidateQueries({ queryKey: userResourceKey(kind, scope) });
	}, [
		summaryRevision,
		coherent,
		expectedRevision,
		revisionsKey,
		loaded,
		scope,
	]);
	return {
		...query,
		data: canUseData ? query.data : undefined,
		isPending:
			query.isPending ||
			savingSettings ||
			(!canUseData && (query.isFetching || !coherent)) ||
			(!!query.data && query.data.revision !== expectedRevision),
	};
}
