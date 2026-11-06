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
	readInboxUnreadCount,
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

/** Count-only key stays under the inbox prefix so mutations invalidate it. */
export const inboxUnreadKey = (scope = getUserScope()) =>
	["user-resources", scope.key, "inbox", "unread-count"] as const;

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
			queryKey: inboxUnreadKey(scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const count = await readInboxUnreadCount(signal);
				currentScope(scope);
				return count;
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
	transactionId: string;
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
	return useInboxMutation("accept", ({ ownerUserId, transactionId }) =>
		acceptInboxShare(ownerUserId, transactionId),
	);
}

export function useDeclineInboxShare() {
	return useInboxMutation("decline", ({ ownerUserId, transactionId }) =>
		declineInboxShare(ownerUserId, transactionId),
	);
}

export function useDismissInboxShare() {
	return useInboxMutation("dismiss", ({ ownerUserId, transactionId }) =>
		dismissInboxShare(ownerUserId, transactionId),
	);
}

export function useUndismissInboxShare() {
	return useInboxMutation("undismiss", ({ ownerUserId, transactionId }) =>
		dismissInboxShare(ownerUserId, transactionId, false),
	);
}

export function useMarkInboxShareRead() {
	return useInboxMutation("read", ({ ownerUserId, transactionId }) =>
		markInboxShareRead(ownerUserId, transactionId, true),
	);
}

export function useMarkInboxShareUnread() {
	return useInboxMutation("unread", ({ ownerUserId, transactionId }) =>
		markInboxShareRead(ownerUserId, transactionId, false),
	);
}
