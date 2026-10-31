import { useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import {
	acceptInvite,
	createGroup,
	createInvite,
	deleteGroup,
	getGroup,
	leaveGroup,
	listGroups,
	listInvites,
	removeMember,
	revokeInvite,
	updateMemberRole,
	type GroupRole,
} from "@/pages/groupsApi.ts";
import { serverQueryClient } from "./serverQuery.ts";

/**
 * Group queries keyed by user scope and selected group. Each selected group
 * owns its detail/invite cache entries, so a late response for group A
 * resolves into A's entry and never overwrites the selected group B. The
 * page reads only the selected entry and holds no mirrored detail state.
 */

export const groupsKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "groups"] as const;

export const groupDetailKey = (groupId: string, scope = getUserScope()) =>
	["user-resources", scope.key, "group-detail", groupId] as const;

export const groupInvitesKey = (groupId: string, scope = getUserScope()) =>
	["user-resources", scope.key, "group-invites", groupId] as const;

function useGroupScope() {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

function currentScope(scope: ReturnType<typeof getUserScope>) {
	if (scope !== getUserScope() || scope.status !== "ready")
		throw new UserScopeError();
}

export function useGroups() {
	const scope = useGroupScope();
	return useQuery(
		{
			queryKey: groupsKey(scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = await listGroups(signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

export function useGroupDetail(groupId: string | null) {
	const scope = useGroupScope();
	return useQuery(
		{
			queryKey: groupDetailKey(groupId ?? "none", scope),
			enabled: scope.status === "ready" && groupId != null,
			queryFn: async ({ signal }) => {
				const result = await getGroup(groupId as string, signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

/** Invites resolve only for owners/admins; members never fetch them. */
export function useGroupInvites(
	groupId: string | null,
	role: GroupRole | null,
) {
	const scope = useGroupScope();
	const canManage = role === "owner" || role === "admin";
	return useQuery(
		{
			queryKey: groupInvitesKey(groupId ?? "none", scope),
			enabled: scope.status === "ready" && groupId != null && canManage,
			queryFn: async ({ signal }) => {
				const result = await listInvites(groupId as string, signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

function invalidateGroups(scope: ReturnType<typeof getUserScope>) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({ queryKey: groupsKey(scope) });
}

function invalidateGroup(
	scope: ReturnType<typeof getUserScope>,
	groupId: string,
) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({ queryKey: groupDetailKey(groupId, scope) });
}

function invalidateInvites(
	scope: ReturnType<typeof getUserScope>,
	groupId: string,
) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({
		queryKey: groupInvitesKey(groupId, scope),
	});
}

export function useCreateGroup() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "create"],
			retry: false,
			mutationFn: async (name: string) => {
				currentScope(scope);
				const result = await createGroup(name);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useJoinGroup() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "join"],
			retry: false,
			mutationFn: async (code: string) => {
				currentScope(scope);
				const result = await acceptInvite(code);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useLeaveGroup() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "leave"],
			retry: false,
			mutationFn: async (groupId: string) => {
				currentScope(scope);
				await leaveGroup(groupId);
				currentScope(scope);
				return groupId;
			},
			onSuccess: async (groupId) => {
				if (scope !== getUserScope()) return;
				cache.removeQueries({ queryKey: groupDetailKey(groupId, scope) });
				cache.removeQueries({ queryKey: groupInvitesKey(groupId, scope) });
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useDeleteGroup() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "delete"],
			retry: false,
			mutationFn: async (groupId: string) => {
				currentScope(scope);
				await deleteGroup(groupId);
				currentScope(scope);
				return groupId;
			},
			onSuccess: async (groupId) => {
				if (scope !== getUserScope()) return;
				cache.removeQueries({ queryKey: groupDetailKey(groupId, scope) });
				cache.removeQueries({ queryKey: groupInvitesKey(groupId, scope) });
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useUpdateMemberRole() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "member-role"],
			retry: false,
			mutationFn: async ({
				groupId,
				accountId,
				role,
			}: {
				groupId: string;
				accountId: string;
				role: GroupRole;
			}) => {
				currentScope(scope);
				await updateMemberRole(groupId, accountId, role);
				currentScope(scope);
				return groupId;
			},
			onSuccess: async (groupId) => {
				await invalidateGroup(scope, groupId);
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useRemoveMember() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "member-remove"],
			retry: false,
			mutationFn: async ({
				groupId,
				accountId,
			}: {
				groupId: string;
				accountId: string;
			}) => {
				currentScope(scope);
				await removeMember(groupId, accountId);
				currentScope(scope);
				return groupId;
			},
			onSuccess: async (groupId) => {
				await invalidateGroup(scope, groupId);
				await invalidateGroups(scope);
			},
		},
		cache,
	);
}

export function useCreateInvite() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "invite-create"],
			retry: false,
			mutationFn: async (groupId: string) => {
				currentScope(scope);
				const result = await createInvite(groupId);
				currentScope(scope);
				return { groupId, ...result };
			},
			onSuccess: async ({ groupId }) => {
				await invalidateInvites(scope, groupId);
			},
		},
		cache,
	);
}

export function useRevokeInvite() {
	const scope = useGroupScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["group-write", scope.key, "invite-revoke"],
			retry: false,
			mutationFn: async ({
				groupId,
				inviteId,
			}: {
				groupId: string;
				inviteId: string;
			}) => {
				currentScope(scope);
				await revokeInvite(groupId, inviteId);
				currentScope(scope);
				return groupId;
			},
			onSuccess: async (groupId) => {
				await invalidateInvites(scope, groupId);
			},
		},
		cache,
	);
}
