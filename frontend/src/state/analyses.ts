import { useMutation, useQuery } from "@tanstack/react-query";
import {
	addPatternToExistingSchedule,
	confirmTransferPair,
	createPatternToNewSchedule,
	dismissAnalysisFinding,
	listAnalyses,
	listAnalysisFindings,
	listTransferLinks,
	previewPatternToExistingSchedule,
	previewPatternToNewSchedule,
	removeTransferLink,
	reviewAnalysisFinding,
} from "@/api/generated/endpoints.ts";
import type { AnalysisFeedbackInput } from "@/api/generated/model/analysisFeedbackInput.ts";
import { ApiNetworkError } from "@/api/http.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { reloadWorkspace } from "./workspaceResources.ts";
import { financialQueryFilter, serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

export const analysisFindingsKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "analysis-findings"] as const;

export function useAnalysisFindings(transactionIds?: string[], cursor = "") {
	const scope = useUserScope();
	const ids = transactionIds
		? [...new Set(transactionIds)].sort().join(",")
		: undefined;
	return useQuery(
		{
			queryKey: [...analysisFindingsKey(scope), ids ?? "all", cursor],
			enabled: scope.status === "ready" && ids !== "",
			queryFn: async ({ signal }) => {
				const result = (
					await listAnalysisFindings(
						{ transactionIds: ids, cursor, limit: 100 },
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

export function usePatternToNewSchedulePreview(findingId: string | undefined) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [
				...analysisFindingsKey(scope),
				"pattern-to-new-schedule-preview",
				findingId ?? "none",
			],
			enabled: scope.status === "ready" && !!findingId,
			queryFn: async ({ signal }) => {
				if (!findingId) throw new UserScopeError();
				const result = (
					await previewPatternToNewSchedule(findingId, { signal })
				).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.preview;
			},
			staleTime: 5_000,
		},
		serverQueryClient(),
	);
}

export function useCreatePatternToNewSchedule() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["pattern-to-new-schedule", scope.key],
			retry: false,
			mutationFn: async ({ id }: { id: string }) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await createPatternToNewSchedule(id)).data;
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

export function usePatternToExistingSchedulePreview(
	findingId: string | undefined,
	scheduleId: string | undefined,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [
				...analysisFindingsKey(scope),
				"pattern-to-existing-schedule-preview",
				findingId ?? "none",
				scheduleId ?? "none",
			],
			enabled: scope.status === "ready" && !!findingId && !!scheduleId,
			queryFn: async ({ signal }) => {
				if (!findingId || !scheduleId) throw new UserScopeError();
				const result = (
					await previewPatternToExistingSchedule(
						findingId,
						{ scheduleId },
						{ signal },
					)
				).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result.preview;
			},
			staleTime: 5_000,
		},
		serverQueryClient(),
	);
}

export function useAddPatternToExistingSchedule() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["pattern-to-existing-schedule", scope.key],
			retry: false,
			mutationFn: async ({
				id,
				scheduleId,
			}: {
				id: string;
				scheduleId: string;
			}) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await addPatternToExistingSchedule(id, { scheduleId }))
					.data;
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

export const transferLinksKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "transfer-links"] as const;

export function useTransferLinks() {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: transferLinksKey(scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = (await listTransferLinks({ signal })).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			staleTime: 5_000,
			refetchInterval: 15_000,
		},
		serverQueryClient(),
	);
}

export function useConfirmTransferPair() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["transfer-pair", scope.key],
			retry: false,
			mutationFn: async ({
				id,
				peerTransactionId,
			}: {
				id: string;
				peerTransactionId: string;
			}) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (
					await confirmTransferPair(id, { peerTransactionId })
				).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			onSuccess: async () => {
				if (scope !== getUserScope()) return;
				await cache.invalidateQueries({
					queryKey: analysisFindingsKey(scope),
				});
				await cache.invalidateQueries({
					queryKey: transferLinksKey(scope),
				});
				await cache.invalidateQueries({
					queryKey: ["flow-graph", scope.key],
				});
				await cache.invalidateQueries(financialQueryFilter(scope.key));
			},
		},
		cache,
	);
}

export function useRemoveTransferLinkByLeg() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["transfer-link", scope.key],
			retry: false,
			mutationFn: async ({ transactionId }: { transactionId: string }) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = (await removeTransferLink(transactionId)).data;
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			onSuccess: async () => {
				if (scope !== getUserScope()) return;
				await cache.invalidateQueries({
					queryKey: analysisFindingsKey(scope),
				});
				await cache.invalidateQueries({
					queryKey: transferLinksKey(scope),
				});
				await cache.invalidateQueries({
					queryKey: ["flow-graph", scope.key],
				});
				await cache.invalidateQueries(financialQueryFilter(scope.key));
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
