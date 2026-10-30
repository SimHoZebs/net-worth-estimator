import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	getServerModel,
	modelOptions,
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
	const model = setServerModelFixture();
	const scope = getUserScope();
	suspendUserScope();
	await cancelResourceQueries();
	expect(getServerModel()).toBeUndefined();
	expect(
		serverQueryClient().getQueryData(userResourceKey("model", scope)),
	).toEqual(model);
});

it("does not publish a retired user's late model result", async () => {
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
			if (path.endsWith("/v1/status"))
				return new Response(JSON.stringify({ readOnly: false }), {
					headers: headers(),
				});
			if (path.endsWith("/v1/financial-model")) return pending;
			return new Response(JSON.stringify({ document: null, issues: [] }), {
				headers: headers(),
			});
		}),
	);
	const old = serverQueryClient()
		.fetchQuery(modelOptions())
		.catch(() => {});
	owner("users/b");
	const current = setServerModelFixture(undefined, { revision: "b" });
	finish(
		new Response(
			JSON.stringify({ document: null, revision: "private-a", issues: [] }),
			{ headers: headers() },
		),
	);
	await old;
	expect(getServerModel()).toEqual(current);
});
