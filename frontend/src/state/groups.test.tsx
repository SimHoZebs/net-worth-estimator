import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptOwnerResource, acceptTestResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import { getUserScope, suspendUserScope } from "../auth/resourceScope.ts";
import type { GroupRole, UserGroup } from "../pages/groupsApi.ts";
import {
	groupDetailKey,
	useCreateGroup,
	useGroupDetail,
	useGroupInvites,
	useGroups,
	useRevokeInvite,
} from "./groups.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={serverQueryClient()}>
			{children}
		</QueryClientProvider>
	);
}

function group(
	id: string,
	role: GroupRole = "owner",
	name?: string,
): UserGroup {
	return {
		id,
		name: name ?? `Group ${id}`,
		role,
		memberCount: 2,
		createdAt: 1,
	};
}

function member(accountId: string, role: GroupRole = "member") {
	return { accountId, role, displayName: accountId, joinedAt: 1 };
}

function seenRequests(fetcher: ReturnType<typeof vi.fn>) {
	return fetcher.mock.calls.map((call) => {
		const [url, init] = call as [string, RequestInit | undefined];
		return {
			url: String(url),
			method: init?.method ?? "GET",
			resource: new Headers(init?.headers).get("Waypoint-Resource"),
		};
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	resetServerQueryCache();
	acceptTestResource();
});

afterEach(() => {
	cleanup();
	suspendUserScope();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

it("loads the group list on mount with the verified user assertion", async () => {
	const fetcher = vi.fn(async () => ok({ groups: [group("g1")] }));
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useGroups(), { wrapper });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data).toEqual([group("g1")]);
	const requests = seenRequests(fetcher);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		url: "/v1/groups",
		method: "GET",
		resource: getUserScope().resource?.id,
	});
});

it("keeps the selected group's detail when another group's response arrives late", async () => {
	const gateA = deferred<unknown>();
	const fetcher = vi.fn(async (url: unknown) => {
		if (String(url).endsWith("/v1/groups/a"))
			return gateA.promise.then((body) => ok(body));
		return ok({
			group: group("b", "owner", "Group B"),
			members: [member("bob")],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(({ id }: { id: string }) => useGroupDetail(id), {
		wrapper,
		initialProps: { id: "a" },
	});
	await waitFor(() =>
		expect(
			seenRequests(fetcher).some((request) =>
				request.url.endsWith("/v1/groups/a"),
			),
		).toBe(true),
	);
	hook.rerender({ id: "b" });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data?.group.id).toBe("b");
	await act(async () => {
		gateA.resolve({
			group: group("a", "owner", "Group A"),
			members: [member("alice")],
		});
	});
	await act(async () => {});
	expect(hook.result.current.data?.group).toEqual(
		group("b", "owner", "Group B"),
	);
	expect(hook.result.current.data?.members).toEqual([member("bob")]);
});

it("never shows late invites for a previously selected group", async () => {
	const gateA = deferred<unknown>();
	const fetcher = vi.fn(async (url: unknown) => {
		if (String(url) === "/v1/groups/a/invites")
			return gateA.promise.then((body) => ok(body));
		return ok({
			invites: [
				{
					id: "invite-b",
					groupId: "b",
					expiresAt: 2,
					maxUses: 5,
					usedCount: 1,
					createdAt: 1,
				},
			],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(
		({ id }: { id: string }) => useGroupInvites(id, "owner"),
		{ wrapper, initialProps: { id: "a" } },
	);
	await waitFor(() =>
		expect(
			seenRequests(fetcher).some(
				(request) => request.url === "/v1/groups/a/invites",
			),
		).toBe(true),
	);
	hook.rerender({ id: "b" });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data?.[0]?.id).toBe("invite-b");
	await act(async () => {
		gateA.resolve({
			invites: [
				{
					id: "invite-a",
					groupId: "a",
					expiresAt: 2,
					maxUses: 5,
					usedCount: 4,
					createdAt: 1,
				},
			],
		});
	});
	await act(async () => {});
	expect(hook.result.current.data?.[0]?.id).toBe("invite-b");
});

it("shows no detail after deselection", async () => {
	const fetcher = vi.fn(async () =>
		ok({ group: group("a"), members: [member("alice")] }),
	);
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(
		({ id }: { id: string | null }) => useGroupDetail(id),
		{ wrapper, initialProps: { id: "a" as string | null } },
	);
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data?.group.id).toBe("a");
	hook.rerender({ id: null });
	expect(hook.result.current.data).toBeUndefined();
	expect(
		seenRequests(fetcher).some((request) => request.url.includes("none")),
	).toBe(false);
});

it("role-gates invites: members never fetch them", async () => {
	const fetcher = vi.fn(async () => ok({ invites: [] }));
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(
		({ role }: { role: GroupRole }) => useGroupInvites("g", role),
		{ wrapper, initialProps: { role: "member" as GroupRole } },
	);
	await act(async () => {});
	expect(hook.result.current.fetchStatus).toBe("idle");
	expect(seenRequests(fetcher)).toHaveLength(0);
	hook.rerender({ role: "admin" });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(
		seenRequests(fetcher).filter(
			(request) => request.url === "/v1/groups/g/invites",
		),
	).toHaveLength(1);
});

it("createGroup invalidates the group list", async () => {
	let created = false;
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		if (String(url) === "/v1/groups" && init?.method === "POST") {
			created = true;
			return ok({ group: group("g2", "owner", "Second") });
		}
		return ok({ groups: created ? [group("g1"), group("g2")] : [group("g1")] });
	});
	vi.stubGlobal("fetch", fetcher);
	const list = renderHook(() => useGroups(), { wrapper });
	await waitFor(() => expect(list.result.current.status).toBe("success"));
	expect(list.result.current.data).toEqual([group("g1")]);
	const create = renderHook(() => useCreateGroup(), { wrapper });
	await act(async () => {
		await create.result.current.mutateAsync("Second");
	});
	await waitFor(() =>
		expect(list.result.current.data).toEqual([group("g1"), group("g2")]),
	);
	expect(
		seenRequests(fetcher).filter(
			(request) => request.url === "/v1/groups" && request.method === "GET",
		),
	).toHaveLength(2);
});

it("revokeInvite invalidates only that group's invites", async () => {
	let revoked = false;
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		if (
			String(url) === "/v1/groups/g/invites/i1" &&
			init?.method === "DELETE"
		) {
			revoked = true;
			return ok(undefined, 204);
		}
		return ok({
			invites: revoked
				? []
				: [
						{
							id: "i1",
							groupId: "g",
							expiresAt: 2,
							maxUses: 5,
							usedCount: 0,
							createdAt: 1,
						},
					],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	const invites = renderHook(() => useGroupInvites("g", "owner"), {
		wrapper,
	});
	await waitFor(() => expect(invites.result.current.status).toBe("success"));
	expect(invites.result.current.data).toHaveLength(1);
	const revoke = renderHook(() => useRevokeInvite(), { wrapper });
	await act(async () => {
		await revoke.result.current.mutateAsync({ groupId: "g", inviteId: "i1" });
	});
	await waitFor(() => expect(invites.result.current.data).toHaveLength(0));
});

it("isolates identical group ids by user scope", async () => {
	acceptOwnerResource("users/one");
	const fetcher = vi.fn(async () => {
		const scope = getUserScope().resource?.id ?? "";
		return ok({
			group: {
				...group("g"),
				name: scope === "users/one" ? "One" : "Two",
			},
			members: [],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useGroupDetail("g"), { wrapper });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data?.group.name).toBe("One");
	acceptOwnerResource("users/two");
	hook.rerender();
	await waitFor(() => expect(hook.result.current.data?.group.name).toBe("Two"));
	const resources = seenRequests(fetcher).map((request) => request.resource);
	expect(resources).toEqual(["users/one", "users/two"]);
	expect(serverQueryClient().getQueryData(groupDetailKey("g"))).toEqual({
		group: { ...group("g"), name: "Two" },
		members: [],
	});
});
