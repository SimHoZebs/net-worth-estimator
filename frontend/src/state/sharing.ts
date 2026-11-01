import { useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import {
	excludeSharedPosting,
	getSharingPolicy,
	grantSharedPosting,
	listSharingGrants,
	previewSharingPolicy,
	removeSharedExclusion,
	revokeSharedPosting,
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

function useSharingScope() {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

function currentScope(scope: ReturnType<typeof getUserScope>) {
	if (scope !== getUserScope() || scope.status !== "ready")
		throw new UserScopeError();
}

export function useSharingPolicy(groupId: string | null) {
	const scope = useSharingScope();
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
	const scope = useSharingScope();
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
	const scope = useSharingScope();
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
	groupId: string,
) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({
		queryKey: sharingPolicyKey(groupId, scope),
	});
}

function invalidateGrants(scope: ReturnType<typeof getUserScope>) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({ queryKey: sharingGrantsKey(scope) });
}

export function useSetSharingPolicy() {
	const scope = useSharingScope();
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
				await invalidatePolicy(scope, groupId);
			},
		},
		cache,
	);
}

export function useGrantSharedPosting() {
	const scope = useSharingScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "grant"],
			retry: false,
			mutationFn: async ({
				postingId,
				audienceId,
			}: {
				postingId: string;
				audienceId: string;
			}) => {
				currentScope(scope);
				const result = await grantSharedPosting(
					postingId,
					"group",
					audienceId,
				);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await invalidateGrants(scope);
			},
		},
		cache,
	);
}

export function useRevokeSharedPosting() {
	const scope = useSharingScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "grant-revoke"],
			retry: false,
			mutationFn: async ({
				postingId,
				audienceType,
				audienceId,
			}: {
				postingId: string;
				audienceType: string;
				audienceId: string;
			}) => {
				currentScope(scope);
				await revokeSharedPosting(postingId, audienceType, audienceId);
				currentScope(scope);
			},
			onSuccess: async () => {
				await invalidateGrants(scope);
			},
		},
		cache,
	);
}

export function useExcludeSharedPosting() {
	const scope = useSharingScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "exclude"],
			retry: false,
			mutationFn: async ({
				postingId,
				audienceType,
				audienceId,
			}: {
				postingId: string;
				audienceType: "group" | "all";
				audienceId: string;
			}) => {
				currentScope(scope);
				const result = await excludeSharedPosting(
					postingId,
					audienceType,
					audienceId,
				);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await invalidateGrants(scope);
			},
		},
		cache,
	);
}

export function useRemoveSharedExclusion() {
	const scope = useSharingScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["sharing-write", scope.key, "exclude-remove"],
			retry: false,
			mutationFn: async ({
				postingId,
				audienceType,
				audienceId,
			}: {
				postingId: string;
				audienceType: string;
				audienceId: string;
			}) => {
				currentScope(scope);
				await removeSharedExclusion(postingId, audienceType, audienceId);
				currentScope(scope);
			},
			onSuccess: async () => {
				await invalidateGrants(scope);
			},
		},
		cache,
	);
}
