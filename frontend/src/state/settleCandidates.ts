import { useQuery } from "@tanstack/react-query";
import { listSettleCandidates } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

export const settleCandidatesKey = (
	postingId: string,
	revision: string | null | undefined,
	scope = getUserScope(),
) => ["settle-candidates", scope.key, postingId, revision ?? ""] as const;

/**
 * Server-owned settlement candidates for one vanished hold. The model
 * revision belongs in the key so a sync or a posting edit cannot serve a
 * stale pair list.
 */
export function useSettleCandidates(
	postingId: string,
	enabled: boolean,
	revision: string | null | undefined,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: settleCandidatesKey(postingId, revision, scope),
			enabled: enabled && scope.status === "ready",
			queryFn: async ({ signal }) =>
				(await listSettleCandidates(postingId, { signal })).data,
		},
		serverQueryClient(),
	);
}
