import { useMutation, useQuery } from "@tanstack/react-query";
import {
	addPatternToExistingRule,
	createPatternToNewRule,
	dismissAnalysisFinding,
	listAnalyses,
	listAnalysisFindings,
	previewPatternToExistingRule,
	previewPatternToNewRule,
	reviewAnalysisFinding,
} from "@/api/generated/endpoints.ts";
import type { AnalysisFeedbackInput } from "@/api/generated/model/analysisFeedbackInput.ts";
import { ApiNetworkError } from "@/api/http.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { reloadWorkspace } from "./workspaceResources.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

export const analysisFindingsKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "analysis-findings"] as const;

export function useAnalysisFindings(postingIds?: string[], cursor = "") {
	const scope = useUserScope();
	const ids = postingIds
		? [...new Set(postingIds)].sort().join(",")
		: undefined;
	return useQuery(
		{
			queryKey: [...analysisFindingsKey(scope), ids ?? "all", cursor],
			enabled: scope.status === "ready" && ids !== "",
			queryFn: async ({ signal }) => {
				const result = (
					await listAnalysisFindings(
						{ postingIds: ids, cursor, limit: 100 },
						{ signal },
					)
				).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			staleTime: 5_000,
			refetchInterval: 15_000,
		},
		serverQueryClient(),
	);
}

export function useAnalyses() {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: ["user-resources", scope.key, "analyses"],
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = (await listAnalyses({ signal })).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			refetchInterval: 15_000,
		},
		serverQueryClient(),
	);
}

export function useDismissAnalysisFinding() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["analysis-review", scope.key],
			retry: false,
			mutationFn: async ({
				id,
				dismissed,
			}: {
				id: string;
				dismissed: boolean;
			}) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				await dismissAnalysisFinding(id, { dismissed });
				if (scope !== getUserScope()) throw new UserScopeError();
			},
			onSuccess: async () => {
				if (scope === getUserScope())
					await cache.invalidateQueries({
						queryKey: analysisFindingsKey(scope),
					});
			},
		},
		cache,
	);
}

export function usePatternToNewRulePreview(findingId: string | undefined) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [
				...analysisFindingsKey(scope),
				"pattern-to-new-rule-preview",
				findingId ?? "none",
			],
			enabled: scope.status === "ready" && !!findingId,
			queryFn: async ({ signal }) => {
				if (!findingId) throw new UserScopeError();
				const result = (await previewPatternToNewRule(findingId, { signal }))
					.data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.preview;
			},
			staleTime: 5_000,
		},
		serverQueryClient(),
	);
}

export function useCreatePatternToNewRule() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["pattern-to-new-rule", scope.key],
			retry: false,
			mutationFn: async ({ id }: { id: string }) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await createPatternToNewRule(id)).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			onSuccess: async () => {
				if (scope !== getUserScope()) return;
				await cache.invalidateQueries({
					queryKey: analysisFindingsKey(scope),
				});
				await reloadWorkspace();
			},
		},
		cache,
	);
}

export function usePatternToExistingRulePreview(
	findingId: string | undefined,
	ruleId: string | undefined,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [
				...analysisFindingsKey(scope),
				"pattern-to-existing-rule-preview",
				findingId ?? "none",
				ruleId ?? "none",
			],
			enabled: scope.status === "ready" && !!findingId && !!ruleId,
			queryFn: async ({ signal }) => {
				if (!findingId || !ruleId) throw new UserScopeError();
				const result = (
					await previewPatternToExistingRule(findingId, { ruleId }, { signal })
				).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.preview;
			},
			staleTime: 5_000,
		},
		serverQueryClient(),
	);
}

export function useAddPatternToExistingRule() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["pattern-to-existing-rule", scope.key],
			retry: false,
			mutationFn: async ({ id, ruleId }: { id: string; ruleId: string }) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await addPatternToExistingRule(id, { ruleId })).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			onSuccess: async () => {
				if (scope !== getUserScope()) return;
				await cache.invalidateQueries({
					queryKey: analysisFindingsKey(scope),
				});
				await reloadWorkspace();
			},
		},
		cache,
	);
}

export function useReviewAnalysisFinding() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["analysis-feedback", scope.key],
			// A network retry reuses the same request ID, even after a lost response.
			retry: (count, error) => count < 1 && error instanceof ApiNetworkError,
			mutationFn: async ({
				id,
				input,
			}: {
				id: string;
				input: AnalysisFeedbackInput;
			}) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await reviewAnalysisFinding(id, input)).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.feedback;
			},
			onSettled: async () => {
				if (scope === getUserScope())
					await cache.invalidateQueries({
						queryKey: analysisFindingsKey(scope),
					});
			},
		},
		cache,
	);
}
