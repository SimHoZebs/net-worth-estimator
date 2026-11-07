import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	getAccountBalances,
	statusOptions,
	userResourceKey,
} from "./workspaceResources.ts";
import {
	cancelResourceQueries,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";

function owner(id: string) {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id,
				permissions: ["user:read", "user:write"],
			},
			subject: id,
		},
		suspendUserScope(),
	);
}
beforeEach(() => {
	owner("users/a");
	resetServerQueryCache();
	vi.unstubAllGlobals();
});
afterEach(() => {
	resetServerQueryCache();
	suspendUserScope();
	vi.unstubAllGlobals();
});

it("retains completed Query data during verification without exposing it under pending scope", async () => {
	const revision = setServerModelFixture();
	const scope = getUserScope();
	suspendUserScope();
	await cancelResourceQueries();
	expect(getAccountBalances()).toBeUndefined();
	expect(
		serverQueryClient().getQueryData<{
			revision: string | null;
		}>([...userResourceKey("balances", scope), "latest"]),
	).toMatchObject({ revision });
});

it("does not publish a retired user's late status result", async () => {
	let finish!: (value: Response) => void;
	const pending = new Promise<Response>((resolve) => {
		finish = resolve;
	});
	const headers = () => {
		const responseHeaders = new Headers({ "content-type": "application/json" });
		const resource = getUserScope().resource?.id;
		if (resource) responseHeaders.set("Waypoint-Resource", resource);
		return responseHeaders;
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown) => {
			const path = String(url);
			if (path.endsWith("/v1/status")) return pending;
			return new Response(JSON.stringify({}), {
				headers: headers(),
			});
		}),
	);
	const old = serverQueryClient()
		.fetchQuery(statusOptions())
		.catch(() => {});
	owner("users/b");
	const revision = setServerModelFixture(undefined, { revision: "b" });
	finish(
		new Response(
			JSON.stringify({ readOnly: false, hasModel: true }),
			{ headers: headers() },
		),
	);
	await old;
	expect(getAccountBalances()?.revision).toBe(revision);
});
