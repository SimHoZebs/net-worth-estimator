import { waypointFetch } from "@/api/waypoint-fetch.ts";
import { mintShareRequestId } from "@/pages/sharingApi.ts";

export type FeedDirection = "in" | "out" | "transfer";

export interface FeedAudience {
	type: "group" | "direct";
	id?: string;
	name: string;
}

export interface FeedAmountInput {
	source: string;
	value?: unknown;
	provider?: string;
	arguments?: Record<string, unknown>;
}

export interface FeedPostingAmount {
	resolver: string;
	config: Record<string, unknown>;
	inputs: Record<string, FeedAmountInput>;
}

export interface FeedPosting {
	id: string;
	name: string;
	sourceAccountId: string | null;
	destinations: string[];
	transactionTime: number;
	pending?: boolean;
	amount: FeedPostingAmount;
}

export interface FeedItem {
	ownerUserId: string;
	sourceDisplayName: string;
	audiences: FeedAudience[];
	posting: FeedPosting;
}

export interface FeedTotals {
	count: number;
	totalAmount: number;
	varyingCount: number;
	pendingCount: number;
}

export interface FeedFilters {
	startDate?: string;
	endDate?: string;
	members?: string[];
	directions?: FeedDirection[];
	limit?: number;
	cursor?: string;
}

export interface FeedPage {
	groupId: string;
	items: FeedItem[];
	totals: FeedTotals;
	page: { nextCursor: string; hasMore: boolean };
}

/** Owner store IDs (user:<hex>) travel as user resources (users/<hex>). */
export function ownerResource(ownerUserId: string): string {
	return `users/${ownerUserId.replace(/^user:/, "")}`;
}

export async function fetchGroupFeed(
	groupId: string,
	filters: FeedFilters = {},
	signal?: AbortSignal,
): Promise<FeedPage> {
	const params = new URLSearchParams();
	if (filters.startDate) params.set("startDate", filters.startDate);
	if (filters.endDate) params.set("endDate", filters.endDate);
	for (const member of filters.members ?? [])
		params.append("member", member);
	for (const direction of filters.directions ?? [])
		params.append("direction", direction);
	if (filters.limit) params.set("limit", String(filters.limit));
	if (filters.cursor) params.set("cursor", filters.cursor);
	const query = params.toString();
	const response = await waypointFetch<{ data: FeedPage }>(
		`/v1/shared/groups/${encodeURIComponent(groupId)}/feed${query ? `?${query}` : ""}`,
		{ signal },
	);
	const body = response.data;
	return {
		groupId: body.groupId,
		items: (body.items ?? []).map((item) => ({
			...item,
			posting: {
				...item.posting,
				sourceAccountId: item.posting.sourceAccountId ?? null,
				destinations: item.posting.destinations ?? [],
			},
		})),
		totals: body.totals ?? {
			count: 0,
			totalAmount: 0,
			varyingCount: 0,
			pendingCount: 0,
		},
		page: body.page ?? { nextCursor: "", hasMore: false },
	};
}

export async function saveSharedCopy(
	ownerUserId: string,
	postingId: string,
	requestId: string = mintShareRequestId(),
): Promise<FeedPosting> {
	const response = await waypointFetch<{ data: { posting: FeedPosting } }>(
		"/v1/shared/copies",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: ownerResource(ownerUserId),
				postingId,
				requestId,
			}),
		},
	);
	return response.data.posting;
}
