import type { Transaction } from "@/api/contracts.ts";
import { waypointFetch } from "@/api/waypoint-fetch.ts";

export type InboxStatus = "pending" | "accepted" | "declined" | "canceled";
export type InboxFilter = InboxStatus | "all";

export interface InboxShareItem {
	kind: "share" | "split-request";
	ownerUserId: string;
	transactionId: string;
	senderDisplayName?: string;
	status: InboxStatus;
	unread: boolean;
	dismissed: boolean;
	receivedAt: number;
	decidedAt?: number;
	copyTransactionId?: string;
	transaction?: Transaction;
}

interface InboxListResponse {
	data: { items: InboxShareItem[]; unreadCount: number };
}

interface InboxItemResponse {
	data: { item: InboxShareItem };
}

/** The inbox mutation endpoints take the user-resource form (users/<hex>),
 * matching the Waypoint-Resource header. Items carry the store form
 * (user:<hex>), so callers convert with ownerResource. */
export function ownerResource(ownerUserId: string): string {
	return `users/${ownerUserId.replace(/^user:/, "")}`;
}

export async function listInbox(
	status: InboxFilter = "pending",
	showDismissed = false,
	signal?: AbortSignal,
): Promise<{ items: InboxShareItem[]; unreadCount: number }> {
	const params = new URLSearchParams({ status });
	if (showDismissed) params.set("showDismissed", "1");
	const response = await waypointFetch<InboxListResponse>(
		`/v1/inbox?${params.toString()}`,
		{ signal },
	);
	return {
		items: response.data.items ?? [],
		unreadCount: response.data.unreadCount ?? 0,
	};
}

/** The badge needs one number, not the item list. */
export async function readInboxUnreadCount(
	signal?: AbortSignal,
): Promise<number> {
	const response = await waypointFetch<{
		data: { unreadCount: number };
	}>("/v1/inbox?status=all&countOnly=1", { signal });
	return response.data.unreadCount ?? 0;
}

async function mutateShare(
	action: "accept" | "decline" | "dismiss" | "read",
	ownerUserId: string,
	transactionId: string,
	extra?: Record<string, boolean>,
): Promise<InboxShareItem> {
	const response = await waypointFetch<InboxItemResponse>(
		`/v1/inbox/shares/${action}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: ownerResource(ownerUserId),
				transactionId,
				...extra,
			}),
		},
	);
	return response.data.item;
}

export function acceptInboxShare(
	ownerUserId: string,
	transactionId: string,
): Promise<InboxShareItem> {
	return mutateShare("accept", ownerUserId, transactionId);
}

export function declineInboxShare(
	ownerUserId: string,
	transactionId: string,
): Promise<InboxShareItem> {
	return mutateShare("decline", ownerUserId, transactionId);
}

export function dismissInboxShare(
	ownerUserId: string,
	transactionId: string,
	dismissed = true,
): Promise<InboxShareItem> {
	return mutateShare("dismiss", ownerUserId, transactionId, { dismissed });
}

export function markInboxShareRead(
	ownerUserId: string,
	transactionId: string,
	read = true,
): Promise<InboxShareItem> {
	return mutateShare("read", ownerUserId, transactionId, { read });
}
