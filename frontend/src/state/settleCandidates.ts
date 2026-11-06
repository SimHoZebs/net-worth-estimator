import { useQuery } from "@tanstack/react-query";
import { listSettleCandidates } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

export const settleCandidatesKey = (
	transactionId: string,
	revision: string | null | undefined,
	scope = getUserScope(),
) => ["settle-candidates", scope.key, transactionId, revision ?? ""] as const;

/**
 * Server-owned settlement candidates for one vanished hold. The model
 * revision belongs in the key so a sync or a transaction edit cannot serve a
 * stale pair list.
 */
export function useSettleCandidates(
	transactionId: string,
	enabled: boolean,
	revision: string | null | undefined,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: settleCandidatesKey(transactionId, revision, scope),
			enabled: enabled && scope.status === "ready",
			queryFn: async ({ signal }) =>
				(await listSettleCandidates(transactionId, { signal })).data,
		},
		serverQueryClient(),
	);
}
