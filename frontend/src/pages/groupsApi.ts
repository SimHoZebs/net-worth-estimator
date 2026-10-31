import { waypointFetch } from "@/api/waypoint-fetch.ts";

export type GroupRole = "owner" | "admin" | "member";

export interface UserGroup {
	id: string;
	name: string;
	role: GroupRole;
	memberCount: number;
	createdAt: number;
}

export interface GroupMember {
	accountId: string;
	role: GroupRole;
	displayName: string;
	joinedAt: number;
}

export interface GroupInvite {
	id: string;
	groupId: string;
	expiresAt: number;
	maxUses: number;
	usedCount: number;
	revokedAt?: number;
	createdAt: number;
}

interface GroupsResponse {
	data: { groups: UserGroup[] };
}

interface GroupDetailResponse {
	data: { group: UserGroup; members: GroupMember[] };
}

interface CreateGroupResponse {
	data: { group: UserGroup };
}

interface InviteResponse {
	data: { invite: GroupInvite; code: string };
}

interface InvitesResponse {
	data: { invites: GroupInvite[] };
}

export async function listGroups(signal?: AbortSignal): Promise<UserGroup[]> {
	const response = await waypointFetch<GroupsResponse>("/v1/groups", {
		signal,
	});
	return response.data.groups ?? [];
}

export async function createGroup(name: string): Promise<UserGroup> {
	const response = await waypointFetch<CreateGroupResponse>("/v1/groups", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	return response.data.group;
}

export async function getGroup(
	id: string,
	signal?: AbortSignal,
): Promise<{ group: UserGroup; members: GroupMember[] }> {
	const response = await waypointFetch<GroupDetailResponse>(
		`/v1/groups/${encodeURIComponent(id)}`,
		{ signal },
	);
	return response.data;
}

export async function deleteGroup(id: string): Promise<void> {
	await waypointFetch(`/v1/groups/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export async function leaveGroup(id: string): Promise<void> {
	await waypointFetch(`/v1/groups/${encodeURIComponent(id)}/leave`, {
		method: "POST",
	});
}

export async function listInvites(
	groupId: string,
	signal?: AbortSignal,
): Promise<GroupInvite[]> {
	const response = await waypointFetch<InvitesResponse>(
		`/v1/groups/${encodeURIComponent(groupId)}/invites`,
		{ signal },
	);
	return response.data.invites ?? [];
}

export async function createInvite(
	groupId: string,
	maxUses = 5,
	ttlDays = 7,
): Promise<{ invite: GroupInvite; code: string }> {
	const response = await waypointFetch<InviteResponse>(
		`/v1/groups/${encodeURIComponent(groupId)}/invites`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ maxUses, ttlDays }),
		},
	);
	return response.data;
}

export async function revokeInvite(
	groupId: string,
	inviteId: string,
): Promise<void> {
	await waypointFetch(
		`/v1/groups/${encodeURIComponent(groupId)}/invites/${encodeURIComponent(inviteId)}`,
		{ method: "DELETE" },
	);
}

export async function acceptInvite(code: string): Promise<UserGroup> {
	const response = await waypointFetch<{ data: { group: UserGroup } }>(
		"/v1/invites/accept",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		},
	);
	return response.data.group;
}

export async function updateMemberRole(
	groupId: string,
	accountId: string,
	role: GroupRole,
): Promise<void> {
	await waypointFetch(
		`/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(accountId)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role }),
		},
	);
}

export async function removeMember(
	groupId: string,
	accountId: string,
): Promise<void> {
	await waypointFetch(
		`/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(accountId)}`,
		{ method: "DELETE" },
	);
}
