import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import {
	excludeSharedPosting,
	getSharingPolicy,
	grantSharedPosting,
	listSharingGrants,
	previewSharingPolicy,
	removeSharedExclusion,
	revokeSharedPosting,
	setSharingPolicy,
} from "./sharingApi.ts";

beforeEach(() => acceptTestResource());
afterEach(() => vi.unstubAllGlobals());

function policy() {
	return {
		ownerUserId: "user:abc",
		groupId: "g1",
		enabled: false,
		accountIds: ["checking"],
		startDate: "2026-01-01",
		version: 1,
		updatedAt: 1,
	};
}

it("resolves an absent preference to null instead of an error", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response("missing", {
				status: 404,
				headers: { "Content-Type": "application/problem+json" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	await expect(getSharingPolicy("g1")).resolves.toBeNull();
	expect(fetcher).toHaveBeenCalledOnce();
});

it("saves the preference with the member's own values", async () => {
	const fetcher = vi.fn(async () => ok({ policy: policy() }));
	vi.stubGlobal("fetch", fetcher);
	await expect(
		setSharingPolicy("g1", {
			enabled: true,
			accountIds: ["checking"],
			startDate: "2026-01-01",
		}),
	).resolves.toEqual(policy());
	const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(url).toBe("/v1/shared/policies/g1");
	expect(init.method).toBe("PUT");
	expect(JSON.parse(String(init.body))).toEqual({
		enabled: true,
		accountIds: ["checking"],
		startDate: "2026-01-01",
		endDate: "",
	});
});

it("previews unsaved values without persisting", async () => {
	const preview = {
		...policy(),
		eligiblePostings: 4,
		memberCount: 3,
	};
	const fetcher = vi.fn(async () => ok({ preview }));
	vi.stubGlobal("fetch", fetcher);
	await expect(
		previewSharingPolicy("g1", {
			accountIds: ["checking"],
			startDate: "2026-01-01",
		}),
	).resolves.toEqual(preview);
	const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(url).toBe("/v1/shared/policies/g1/preview");
	expect(init.method).toBe("POST");
});

it("lists grants and shares, revokes, excludes, and removes", async () => {
	const grant = {
		ownerUserId: "user:abc",
		postingId: "p1",
		audienceType: "group",
		audienceId: "g1",
		intent: "shared",
		createdAt: 1,
	};
	const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			calls.push({
				url: String(url),
				method: init?.method,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			if (String(url) === "/v1/shared/grants" && !init?.method)
				return ok({ grants: [grant] });
			if (String(url) === "/v1/shared/grants") return ok({ grant });
			return ok({ exclusion: grant });
		}),
	);
	await expect(listSharingGrants()).resolves.toEqual([grant]);
	await expect(grantSharedPosting("p1", "group", "g1")).resolves.toEqual(grant);
	await revokeSharedPosting("p1", "group", "g1");
	await excludeSharedPosting("p1", "group", "g1");
	await removeSharedExclusion("p1", "group", "g1");
	expect(calls.map((call) => call.method ?? "GET")).toEqual([
		"GET",
		"POST",
		"DELETE",
		"POST",
		"DELETE",
	]);
	// Every mutating share call carries a caller UUID idempotency key
	// alongside its preserved fields.
	const uuidPattern =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const bodies = calls.slice(1).map((call) => {
		const body = call.body as Record<string, unknown>;
		expect(body.requestId).toMatch(uuidPattern);
		const { requestId: _dropped, ...rest } = body;
		return rest;
	});
	expect(bodies).toEqual([
		{ postingId: "p1", audienceType: "group", audienceId: "g1" },
		{ postingId: "p1", audienceType: "group", audienceId: "g1" },
		{ postingId: "p1", audienceType: "group", audienceId: "g1" },
		{ postingId: "p1", audienceType: "group", audienceId: "g1" },
	]);
});

it("reuses one key for one share action and mints fresh keys per action", async () => {
	const grant = {
		ownerUserId: "user:abc",
		postingId: "p1",
		audienceType: "group",
		audienceId: "g1",
		intent: "shared",
		createdAt: 1,
	};
	const keys: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			keys.push(
				(JSON.parse(String(init?.body)) as Record<string, unknown>).requestId,
			);
			return ok({ grant });
		}),
	);
	const key = "11111111-2222-4333-8444-555555555555";
	await grantSharedPosting("p1", "group", "g1", key);
	await grantSharedPosting("p1", "group", "g1", key);
	expect(keys).toEqual([key, key]);
	await grantSharedPosting("p1", "group", "g1");
	expect(keys).toHaveLength(3);
	expect(keys[2]).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	);
	expect(keys[2]).not.toBe(key);
});
