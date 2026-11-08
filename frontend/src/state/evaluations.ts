import { useQuery } from "@tanstack/react-query";
import { listEvaluationsStatus } from "@/api/generated/endpoints.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

export const evaluationStatusKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "evaluations-status"] as const;

export type EvaluationStatus = {
	state: "idle" | "queued" | "running" | "failed" | "succeeded";
	currentRevision: number;
	publishedRevision: number;
	dirtyFrom: number;
	fingerprint: string;
	projectionAvailable: boolean;
};

// useEvaluationStatus is passive: it polls worker status without starting
// work, with refetchInterval 15s matching the background analysis pattern.
export function useEvaluationStatus() {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: evaluationStatusKey(scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = (await listEvaluationsStatus({ signal })).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.status as unknown as EvaluationStatus;
			},
			refetchInterval: 15_000,
		},
		serverQueryClient(),
	);
}
