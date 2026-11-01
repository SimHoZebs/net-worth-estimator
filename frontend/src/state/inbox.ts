import { useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import {
	acceptInboxShare,
	declineInboxShare,
	dismissInboxShare,
	listInbox,
	markInboxShareRead,
	type InboxFilter,
} from "@/pages/inboxApi.ts";
import { serverQueryClient } from "./serverQuery.ts";

/**
 * Inbox queries keyed by user scope, status filter, and the show-dismissed
 * flag. Mutations invalidate every inbox entry for the scope so tab
 * switches, the unread badge, and the sidebar count refresh together.
 * Mutations never retry: every inbox mutation is server-idempotent, so a
 * retry would only replay an already-recorded decision.
 */

export const inboxKey = (
	status: InboxFilter,
	showDismissed: boolean,
	scope = getUserScope(),
) => ["user-resources", scope.key, "inbox", status, showDismissed] as const;

function useInboxScope() {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

function currentScope(scope: ReturnType<typeof getUserScope>) {
	if (scope !== getUserScope() || scope.status !== "ready")
		throw new UserScopeError();
}

export function useInbox(status: InboxFilter, showDismissed = false) {
	const scope = useInboxScope();
	return useQuery(
		{
			queryKey: inboxKey(status, showDismissed, scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = await listInbox(status, showDismissed, signal);
				currentScope(scope);
				return result;
			},
		},
		serverQueryClient(),
	);
}

/** Unread badge count across every status; dismissed items never badge. */
export function useInboxUnreadCount() {
	const scope = useInboxScope();
	return useQuery(
		{
			queryKey: inboxKey("all", false, scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const result = await listInbox("all", false, signal);
				currentScope(scope);
				return result.unreadCount;
			},
		},
		serverQueryClient(),
	);
}

function invalidateInbox(scope: ReturnType<typeof getUserScope>) {
	const cache = serverQueryClient();
	if (scope !== getUserScope()) return Promise.resolve();
	return cache.invalidateQueries({
		queryKey: ["user-resources", scope.key, "inbox"],
	});
}

export type InboxShareTarget = {
	ownerUserId: string;
	postingId: string;
};

function useInboxMutation(
	name: string,
	mutationFn: (target: InboxShareTarget) => Promise<unknown>,
) {
	const scope = useInboxScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["inbox-write", scope.key, name],
			retry: false,
			mutationFn: async (target: InboxShareTarget) => {
				currentScope(scope);
				const result = await mutationFn(target);
				currentScope(scope);
				return result;
			},
			onSuccess: async () => {
				await invalidateInbox(scope);
			},
		},
		cache,
	);
}

export function useAcceptInboxShare() {
	return useInboxMutation("accept", ({ ownerUserId, postingId }) =>
		acceptInboxShare(ownerUserId, postingId),
	);
}

export function useDeclineInboxShare() {
	return useInboxMutation("decline", ({ ownerUserId, postingId }) =>
		declineInboxShare(ownerUserId, postingId),
	);
}

export function useDismissInboxShare() {
	return useInboxMutation("dismiss", ({ ownerUserId, postingId }) =>
		dismissInboxShare(ownerUserId, postingId),
	);
}

export function useUndismissInboxShare() {
	return useInboxMutation("undismiss", ({ ownerUserId, postingId }) =>
		dismissInboxShare(ownerUserId, postingId, false),
	);
}

export function useMarkInboxShareRead() {
	return useInboxMutation("read", ({ ownerUserId, postingId }) =>
		markInboxShareRead(ownerUserId, postingId, true),
	);
}

export function useMarkInboxShareUnread() {
	return useInboxMutation("unread", ({ ownerUserId, postingId }) =>
		markInboxShareRead(ownerUserId, postingId, false),
	);
}
