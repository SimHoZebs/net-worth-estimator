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
	expect(fetcher.mock.calls[0]?.[0]).toBe("/v1/shared/groups/g1/feed");
});

it("saves a copy through the recipient copy flow", async () => {
	const posting = { id: "p1", name: "Groceries" };
	const fetcher = vi.fn(async () => ok({ posting }));
	vi.stubGlobal("fetch", fetcher);
	await expect(saveSharedCopy("user:abc123", "p1")).resolves.toEqual(
		posting,
	);
	const [url, options] = fetcher.mock.calls[0] as unknown as [
		string,
		RequestInit,
	];
	expect(url).toBe("/v1/shared/copies");
	expect(options.method).toBe("POST");
	expect(JSON.parse(String(options.body))).toEqual({
		owner: "users/abc123",
		postingId: "p1",
	});
});
