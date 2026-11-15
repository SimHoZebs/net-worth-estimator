import { queryOptions, useIsMutating, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getSafeSpendingSummary } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
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

export function safeSpendingSummaryOptions(
	start: string,
	end: string,
	revisions: readonly (string | null | undefined)[],
	scope = getUserScope(),
) {
	return queryOptions({
		queryKey: [
			...userResourceKey("safe-spending-summary", scope),
			start,
			end,
			...revisions,
			getSafeSpendingSettings(scope),
		],
		queryFn: async ({ signal }) =>
			(
				await getSafeSpendingSummary(
					{ start, end },
					{ signal, cache: "no-store" },
				)
			).data,
		staleTime: Infinity,
		retry: false,
	});
}

export function useSafeSpendingSummary(
	start: string,
	end: string,
	enabled = true,
) {
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
			...safeSpendingSummaryOptions(start, end, revisions, scope),
			enabled:
				enabled && scope.status === "ready" && coherent && !savingSettings,
			refetchOnMount: "always",
		},
		serverQueryClient(),
	);
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
		data:
			enabled &&
			coherent &&
			!savingSettings &&
			!query.isFetching &&
			!query.isError &&
			query.data?.revision === expectedRevision
				? query.data
				: undefined,
		isPending:
			query.isPending ||
			savingSettings ||
			query.isFetching ||
			!coherent ||
			(!!query.data && query.data.revision !== expectedRevision),
	};
}
