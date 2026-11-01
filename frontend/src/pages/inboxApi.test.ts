import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getUserScope } from "../auth/resourceScope.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import {
	acceptInboxShare,
	listInbox,
	markInboxShareRead,
	ownerResource,
} from "./inboxApi.ts";

beforeEach(() => acceptTestResource());
afterEach(() => vi.unstubAllGlobals());

it("converts the store owner form to the user-resource form", () => {
	expect(ownerResource("user:abc123")).toBe("users/abc123");
});

it("asserts the verified user for inbox requests", async () => {
	const fetcher = vi.fn(async () => ok({ items: [], unreadCount: 0 }));
	vi.stubGlobal("fetch", fetcher);
	expect(await listInbox()).toEqual({ items: [], unreadCount: 0 });
	const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(options[0]).toBe("/v1/inbox?status=pending");
	expect(new Headers(options[1].headers).get("Waypoint-Resource")).toBe(
		getUserScope().resource?.id,
	);
});

it("passes the status filter and the show-dismissed flag", async () => {
	const fetcher = vi.fn(async () => ok({ items: [], unreadCount: 3 }));
	vi.stubGlobal("fetch", fetcher);
	expect(await listInbox("canceled", true)).toEqual({
		items: [],
		unreadCount: 3,
	});
	const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(options[0]).toBe("/v1/inbox?status=canceled&showDismissed=1");
});

it("accepts with the user-resource owner form", async () => {
	const fetcher = vi.fn(async () =>
		ok({ item: { status: "accepted", copyPostingId: "copy-1" } }),
	);
	vi.stubGlobal("fetch", fetcher);
	expect(await acceptInboxShare("user:abc123", "posting-1")).toEqual({
		status: "accepted",
		copyPostingId: "copy-1",
	});
	const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(options[0]).toBe("/v1/inbox/shares/accept");
	expect(JSON.parse(options[1].body as string)).toEqual({
		owner: "users/abc123",
		postingId: "posting-1",
	});
});

it("marks read with an explicit flag", async () => {
	const fetcher = vi.fn(async () => ok({ item: { unread: false } }));
	vi.stubGlobal("fetch", fetcher);
	expect(await markInboxShareRead("user:abc123", "posting-1", false)).toEqual({
		unread: false,
	});
	const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(JSON.parse(options[1].body as string)).toEqual({
		owner: "users/abc123",
		postingId: "posting-1",
		read: false,
	});
});

it("leaves inbox mutation grants to the server", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					status: 403,
					detail: "This action is not permitted.",
				}),
				{
					status: 403,
					headers: {
						"Content-Type": "application/problem+json",
						"Waypoint-Resource": getUserScope().resource!.id,
					},
				},
			),
	);
	vi.stubGlobal("fetch", fetcher);
	await expect(acceptInboxShare("user:abc123", "posting-1")).rejects.toThrow(
		"This action is not permitted.",
	);
	expect(fetcher).toHaveBeenCalledOnce();
});
