import { useMutation, useQuery } from "@tanstack/react-query";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useUserScope } from "./useUserScope.ts";
import {
	excludeSharedTransaction,
	getSharingPolicy,
	grantSharedTransaction,
	listSharingGrants,
	previewSharingPolicy,
	removeSharedExclusion,
	revokeSharedTransaction,
	setSharingPolicy,
	type SharingPolicyInput,
} from "@/pages/sharingApi.ts";
import { serverQueryClient } from "./serverQuery.ts";

/**
 * Sharing consent state keyed by user scope. The policy entry holds the
 * member's own stored preference per group (absent means off); the grants
 * entry holds the owner's explicit per-transaction intents. Failed edits
 * stay local to the form for retry, matching the plan-editor contract.
 */

export const sharingPolicyKey = (groupId: string, scope = getUserScope()) =>
	["user-resources", scope.key, "sharing-policy", groupId] as const;

export const sharingGrantsKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "sharing-grants"] as const;

function currentScope(scope: ReturnType<typeof getUserScope>) {
	if (scope !== getUserScope() || scope.status !== "ready")
		throw new UserScopeError();
}

export function useSharingPolicy(groupId: string | null) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: sharingPolicyKey(groupId ?? "none", scope),
			enabled: scope.status === "ready" && groupId != null,
			queryFn: async ({ signal }) => {
				const result = await getSharingPolicy(groupId as string, signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

export function useSharingPreview(
	groupId: string | null,
	input: Omit<SharingPolicyInput, "enabled"> | null,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [
				"user-resources",
				scope.key,
				"sharing-preview",
				groupId ?? "none",
				(input?.accountIds ?? []).join(","),
				input?.startDate ?? "",
				input?.endDate ?? "",
			] as const,
			enabled:
				scope.status === "ready" &&
				groupId != null &&
				input != null &&
				input.accountIds.length > 0,
			queryFn: async ({ signal }) => {
				const result = await previewSharingPolicy(
					groupId as string,
					input as Omit<SharingPolicyInput, "enabled">,
					signal,
				);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

export function useSharingGrants() {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: sharingGrantsKey(scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = await listSharingGrants(signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

function invalidatePolicy(
	scope: ReturnType<typeof getUserScope>,
	groupId?: string,
) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({
		queryKey:
			groupId == null
				? (["user-resources", scope.key, "sharing-policy"] as const)
				: sharingPolicyKey(groupId, scope),
	});
}

function invalidateGrants(scope: ReturnType<typeof getUserScope>) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({ queryKey: sharingGrantsKey(scope) });
}

function invalidateFeed(
	scope: ReturnType<typeof getUserScope>,
	groupId?: string,
) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	const base = ["user-resources", scope.key, "group-feed"] as const;
	return cache.invalidateQueries({
		queryKey: groupId == null ? base : ([...base, groupId] as const),
	});
}

function invalidatePreview(scope: ReturnType<typeof getUserScope>) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({
		queryKey: ["user-resources", scope.key, "sharing-preview"] as const,
	});
}

/**
 * Post-commit refresh for every mutation that can change what the group
 * views show: policy saves, grant/exclusion changes, and membership
 * transitions. Feed, preview, totals, and counts derive from the same
 * gated reads, so one refresh leaves them all showing post-commit truth
 * with no manual reload.
 */
export function refreshSharingViews(
	scope: ReturnType<typeof getUserScope>,
	groupId?: string,
) {
	return Promise.all([
		invalidatePolicy(scope, groupId),
		invalidateGrants(scope),
		invalidateFeed(scope, groupId),
		invalidatePreview(scope),
	]).then(() => undefined);
}

/** Current-scope refresh for call sites outside mutation hooks. */
export function refreshSharingViewsFor(groupId?: string) {
	return refreshSharingViews(getUserScope(), groupId);
}

export function useSetSharingPolicy() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "policy"],
			retry: false,
			mutationFn: async ({
				groupId,
				input,
			}: {
				groupId: string;
				input: SharingPolicyInput;
			}) => {
				currentScope(scope);
				const result = await setSharingPolicy(groupId, input);
				currentScope(scope);
				return { groupId, policy: result };
			},
			onSuccess: async ({ groupId }) => {
				await refreshSharingViews(scope, groupId);
			},
		},
		cache,
	);
}

export function useGrantSharedTransaction() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "grant"],
			retry: false,
			mutationFn: async ({
				transactionId,
				audienceId,
				requestId,
			}: {
				transactionId: string;
				audienceId: string;
				requestId?: string;
			}) => {
				currentScope(scope);
				const result = await grantSharedTransaction(
					transactionId,
					"group",
					audienceId,
					requestId,
				);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await refreshSharingViews(scope);
			},
		},
		cache,
	);
}

export function useRevokeSharedTransaction() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "grant-revoke"],
			retry: false,
			mutationFn: async ({
				transactionId,
				audienceType,
				audienceId,
				requestId,
			}: {
				transactionId: string;
				audienceType: string;
				audienceId: string;
				requestId?: string;
			}) => {
				currentScope(scope);
				await revokeSharedTransaction(
					transactionId,
					audienceType,
					audienceId,
					requestId,
				);
				currentScope(scope);
			},
			onSuccess: async () => {
				await refreshSharingViews(scope);
			},
		},
		cache,
	);
}

export function useExcludeSharedTransaction() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "exclude"],
			retry: false,
			mutationFn: async ({
				transactionId,
				audienceType,
				audienceId,
				requestId,
			}: {
				transactionId: string;
				audienceType: "group" | "all";
				audienceId: string;
				requestId?: string;
			}) => {
				currentScope(scope);
				const result = await excludeSharedTransaction(
					transactionId,
					audienceType,
					audienceId,
					requestId,
				);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await refreshSharingViews(scope);
			},
		},
		cache,
	);
}

export function useRemoveSharedExclusion() {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "exclude-remove"],
			retry: false,
			mutationFn: async ({
				transactionId,
				audienceType,
				audienceId,
				requestId,
			}: {
				transactionId: string;
				audienceType: string;
				audienceId: string;
				requestId?: string;
			}) => {
				currentScope(scope);
				await removeSharedExclusion(
					transactionId,
					audienceType,
					audienceId,
					requestId,
				);
				currentScope(scope);
			},
			onSuccess: async () => {
				await refreshSharingViews(scope);
			},
		},
		cache,
	);
}
