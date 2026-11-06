import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getUserScope } from "../../auth/resourceScope.ts";
import { ok } from "../../mocks/fetch.ts";
import {
	fetchGroupFeed,
	ownerResource,
	saveSharedCopy,
} from "./sharedFeedApi.ts";
import { acceptTestResource } from "../../mocks/resource.ts";

beforeEach(() => acceptTestResource());
afterEach(() => vi.unstubAllGlobals());

function feedBody() {
	return {
		groupId: "g1",
		items: [],
		totals: { count: 0, totalAmount: 0, varyingCount: 0, pendingCount: 0 },
		page: { nextCursor: "", hasMore: false },
	};
}

it("converts owner store IDs to user resources", () => {
	expect(ownerResource("user:abc123")).toBe("users/abc123");
});

it("passes navigation filters as query parameters", async () => {
	const fetcher = vi.fn(async () => ok(feedBody()));
	vi.stubGlobal("fetch", fetcher);
	await fetchGroupFeed("g1", {
		startDate: "2026-01-01",
		endDate: "2026-12-31",
		members: ["users/abc"],
		directions: ["out"],
		limit: 10,
		cursor: "cursor-value",
	});
	const [url, options] = fetcher.mock.calls[0] as unknown as [
		string,
		RequestInit,
	];
	expect(url).toBe(
		"/v1/shared/groups/g1/feed?startDate=2026-01-01&endDate=2026-12-31&member=users%2Fabc&direction=out&limit=10&cursor=cursor-value",
	);
	expect(new Headers(options.headers).get("Waypoint-Resource")).toBe(
		getUserScope().resource?.id,
	);
});

it("omits empty filters from the feed request", async () => {
	const fetcher = vi.fn(async () => ok(feedBody()));
	vi.stubGlobal("fetch", fetcher);
	await fetchGroupFeed("g1");
	const [url] = fetcher.mock.calls[0] as unknown as [string];
	expect(url).toBe("/v1/shared/groups/g1/feed");
});

it("saves a copy through the recipient copy flow", async () => {
	const transaction = { id: "p1", name: "Groceries" };
	const fetcher = vi.fn(async () => ok({ transaction }));
	vi.stubGlobal("fetch", fetcher);
	await expect(saveSharedCopy("user:abc123", "p1")).resolves.toEqual(
		transaction,
	);
	const [url, options] = fetcher.mock.calls[0] as unknown as [
		string,
		RequestInit,
	];
	expect(url).toBe("/v1/shared/copies");
	expect(options.method).toBe("POST");
	const body = JSON.parse(String(options.body)) as Record<string, string>;
	expect(body.owner).toBe("users/abc123");
	expect(body.transactionId).toBe("p1");
	expect(body.requestId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	);
});

it("mints a fresh idempotency key per saved copy", async () => {
	const transaction = { id: "p1", name: "Groceries" };
	const bodies: string[] = [];
	const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
		bodies.push(String(options?.body));
		return ok({ transaction });
	});
	vi.stubGlobal("fetch", fetcher);
	await saveSharedCopy("user:abc123", "p1");
	await saveSharedCopy("user:abc123", "p1");
	const keys = bodies.map(
		(body) => (JSON.parse(body) as Record<string, string>).requestId,
	);
	expect(keys).toHaveLength(2);
	expect(keys[0]).not.toBe(keys[1]);
});

it("reuses the caller's key for one share action", async () => {
	const transaction = { id: "p1", name: "Groceries" };
	const fetcher = vi.fn(async () => ok({ transaction }));
	vi.stubGlobal("fetch", fetcher);
	await saveSharedCopy(
		"user:abc123",
		"p1",
		"11111111-2222-4333-8444-555555555555",
	);
	const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(JSON.parse(String(options.body))).toEqual({
		owner: "users/abc123",
		transactionId: "p1",
		requestId: "11111111-2222-4333-8444-555555555555",
	});
});
