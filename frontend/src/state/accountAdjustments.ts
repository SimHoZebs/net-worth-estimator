import { queryOptions, useQuery } from "@tanstack/react-query";
import { listBalanceAdjustments } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useUserScope } from "./useUserScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { balancesOptions, refreshAccounts } from "./workspaceResources.ts";

export function accountAdjustmentsOptions(
	accountId: string,
	scope = getUserScope(),
) {
	return queryOptions({
		queryKey: ["account-adjustments", scope.key, accountId],
		queryFn: async ({ signal }) => {
			const result = await listBalanceAdjustments(accountId, { signal });
			if (scope !== getUserScope()) throw new Error("The active user changed.");
			return result.data.adjustments;
		},
		staleTime: Infinity,
		retry: false,
	});
}

export function useAccountAdjustments(accountId: string, enabled = true) {
	const scope = useUserScope();
	// The cached balances revision invalidates this query without fetching.
	const revision = useQuery(
		{
			...balancesOptions(scope),
			enabled: false,
			select: (row) => row.revision,
		},
		serverQueryClient(),
	).data;
	const options = accountAdjustmentsOptions(accountId, scope);
	return useQuery(
		{
			...options,
			queryKey: [...options.queryKey, revision ?? ""],
			enabled: enabled && scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export async function refreshAccountAdjustments() {
	const scope = getUserScope();
	await Promise.all([
		refreshAccounts(),
		serverQueryClient().invalidateQueries({
			queryKey: ["account-adjustments", scope.key],
		}),
	]);
}
