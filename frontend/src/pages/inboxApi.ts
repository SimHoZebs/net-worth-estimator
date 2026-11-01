import type { Posting } from "@/api/contracts.ts";
import { waypointFetch } from "@/api/waypoint-fetch.ts";

export type InboxStatus = "pending" | "accepted" | "declined" | "canceled";
export type InboxFilter = InboxStatus | "all";

export interface InboxShareItem {
	kind: "share" | "split-request";
	ownerUserId: string;
	postingId: string;
	senderDisplayName?: string;
	status: InboxStatus;
	unread: boolean;
	dismissed: boolean;
	receivedAt: number;
	decidedAt?: number;
	copyPostingId?: string;
	posting?: Posting;
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

async function mutateShare(
	action: "accept" | "decline" | "dismiss" | "read",
	ownerUserId: string,
	postingId: string,
	extra?: Record<string, boolean>,
): Promise<InboxShareItem> {
	const response = await waypointFetch<InboxItemResponse>(
		`/v1/inbox/shares/${action}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: ownerResource(ownerUserId),
				postingId,
				...extra,
			}),
		},
	);
	return response.data.item;
}

export function acceptInboxShare(
	ownerUserId: string,
	postingId: string,
): Promise<InboxShareItem> {
	return mutateShare("accept", ownerUserId, postingId);
}

export function declineInboxShare(
	ownerUserId: string,
	postingId: string,
): Promise<InboxShareItem> {
	return mutateShare("decline", ownerUserId, postingId);
}

export function dismissInboxShare(
	ownerUserId: string,
	postingId: string,
	dismissed = true,
): Promise<InboxShareItem> {
	return mutateShare("dismiss", ownerUserId, postingId, { dismissed });
}

export function markInboxShareRead(
	ownerUserId: string,
	postingId: string,
	read = true,
): Promise<InboxShareItem> {
	return mutateShare("read", ownerUserId, postingId, { read });
}
