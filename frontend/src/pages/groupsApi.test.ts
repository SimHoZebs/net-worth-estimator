import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getUserScope } from "../auth/resourceScope.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import { createGroup, listGroups } from "./groupsApi.ts";

beforeEach(() => acceptTestResource());
afterEach(() => vi.unstubAllGlobals());

it("asserts the verified user for group requests", async () => {
	const fetcher = vi.fn(async () => ok({ groups: [] }));
	vi.stubGlobal("fetch", fetcher);
	expect(await listGroups()).toEqual([]);
	const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
	expect(options[0]).toBe("/v1/groups");
	expect(new Headers(options[1].headers).get("Waypoint-Resource")).toBe(
		getUserScope().resource?.id,
	);
});

it("leaves group mutation grants to the server", async () => {
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
	await expect(createGroup("Household")).rejects.toThrow(
		"This action is not permitted.",
	);
	expect(fetcher).toHaveBeenCalledOnce();
});
