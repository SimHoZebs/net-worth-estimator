import { ApiError } from "@/api/http.ts";
import { waypointFetch } from "@/api/waypoint-fetch.ts";

export type SharingAudienceType = "user" | "group" | "all";
export type SharingIntent = "shared" | "excluded";

export interface SharingPolicy {
	ownerUserId: string;
	groupId: string;
	enabled: boolean;
	accountIds: string[];
	startDate: string;
	endDate?: string;
	version: number;
	updatedAt: number;
}

export interface SharingPolicyInput {
	enabled: boolean;
	accountIds: string[];
	startDate?: string;
	endDate?: string;
}

/**
 * Counts-only exposure preview. Audience size and eligible-row counts plus
 * the interval and account coverage; never amounts, payees, or row IDs.
 */
export interface SharingPolicyPreview {
	ownerUserId: string;
	groupId: string;
	enabled: boolean;
	accountIds: string[];
	startDate: string;
	endDate?: string;
	version: number;
	eligiblePostings: number;
	memberCount: number;
}

export interface SharingGrant {
	ownerUserId: string;
	postingId: string;
	audienceType: SharingAudienceType;
	audienceId: string;
	intent: SharingIntent;
	createdAt: number;
}

interface PolicyResponse {
	data: { policy: SharingPolicy };
}

interface PreviewResponse {
	data: { preview: SharingPolicyPreview };
}

interface GrantsResponse {
	data: { grants: SharingGrant[] };
}

interface GrantResponse {
	data: { grant: SharingGrant };
}

/**
 * One idempotency key per user-initiated share mutation. The caller mints
 * the key when the user acts and reuses that same key for every attempt of
 * that action; a new user action mints a new key. The audit port replays
 * the recorded outcome for a repeated key and rejects key-less mutations.
 */
export function mintShareRequestId(): string {
	return crypto.randomUUID();
}

function policyPath(groupId: string): string {
	return `/v1/shared/policies/${encodeURIComponent(groupId)}`;
}

/**
 * One member's stored preference for one group. Absent (404) means
 * automatic sharing is off; resolves null so the consent screen renders
 * the off-by-default state instead of an error.
 */
export async function getSharingPolicy(
	groupId: string,
	signal?: AbortSignal,
): Promise<SharingPolicy | null> {
	try {
		const response = await waypointFetch<PolicyResponse>(policyPath(groupId), {
			signal,
		});
		return response.data.policy;
	} catch (cause) {
		if (cause instanceof ApiError && cause.status === 404) return null;
		throw cause;
	}
}

export async function setSharingPolicy(
	groupId: string,
	input: SharingPolicyInput,
): Promise<SharingPolicy> {
	const response = await waypointFetch<PolicyResponse>(policyPath(groupId), {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			enabled: input.enabled,
			accountIds: input.accountIds,
			startDate: input.startDate ?? "",
			endDate: input.endDate ?? "",
		}),
	});
	return response.data.policy;
}

/**
 * Counts-only preview for unsaved preference values. Persists nothing, so
 * the consent screen can show exposure before enabling. Rejects unknown
 * accounts and invalid intervals with the server message, safe to show.
 */
export async function previewSharingPolicy(
	groupId: string,
	input: Omit<SharingPolicyInput, "enabled">,
	signal?: AbortSignal,
): Promise<SharingPolicyPreview> {
	const response = await waypointFetch<PreviewResponse>(
		`${policyPath(groupId)}/preview`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				accountIds: input.accountIds,
				startDate: input.startDate ?? "",
				endDate: input.endDate ?? "",
			}),
			signal,
		},
	);
	return response.data.preview;
}

/** The owner's explicit per-transaction grants and exclusions. */
export async function listSharingGrants(
	signal?: AbortSignal,
): Promise<SharingGrant[]> {
	const response = await waypointFetch<GrantsResponse>("/v1/shared/grants", {
		signal,
	});
	return response.data.grants ?? [];
}

export async function grantSharedPosting(
	postingId: string,
	audienceType: "group",
	audienceId: string,
	requestId: string = mintShareRequestId(),
): Promise<SharingGrant> {
	const response = await waypointFetch<GrantResponse>("/v1/shared/grants", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ postingId, audienceType, audienceId, requestId }),
	});
	return response.data.grant;
}

export async function revokeSharedPosting(
	postingId: string,
	audienceType: string,
	audienceId: string,
	requestId: string = mintShareRequestId(),
): Promise<void> {
	await waypointFetch("/v1/shared/grants", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ postingId, audienceType, audienceId, requestId }),
	});
}

export async function excludeSharedPosting(
	postingId: string,
	audienceType: "group" | "all",
	audienceId: string,
	requestId: string = mintShareRequestId(),
): Promise<SharingGrant> {
	const response = await waypointFetch<GrantResponse>("/v1/shared/exclusions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			postingId,
			audienceType,
			audienceId,
			requestId,
		}),
	});
	return response.data.grant;
}

export async function removeSharedExclusion(
	postingId: string,
	audienceType: string,
	audienceId: string,
	requestId: string = mintShareRequestId(),
): Promise<void> {
	await waypointFetch("/v1/shared/exclusions", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ postingId, audienceType, audienceId, requestId }),
	});
}
