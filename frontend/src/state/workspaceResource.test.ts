import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptAccountScope,
	canonicalApiBaseUrl,
	getAccountScope,
	suspendAccountScope,
} from "../auth/resourceScope.ts";
import {
	resetWorkspaceForResource,
	resetWorkspaceStore,
	useWorkspaceStore,
} from "./workspaceStore.ts";
import {
	getServerModel,
	modelOptions,
	accountResourceKey,
} from "./workspaceResources.ts";
import {
	cancelResourceQueries,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import { setServerModelFixture } from "../mocks/workspace.ts";
import { testAccount } from "../mocks/account.ts";

function owner(id: string) {
	acceptAccountScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id,
				kind: "private",
				permissions: ["account:read", "account:write"],
			},
			subject: id,
		},
		suspendAccountScope(),
	);
}
beforeEach(() => {
	owner("accounts/a");
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});
afterEach(() => {
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendAccountScope();
	vi.unstubAllGlobals();
});

it("retains completed Query data during verification without exposing it under pending scope", async () => {
	const model = setServerModelFixture();
	const scope = getAccountScope();
	useWorkspaceStore.setState({ draft: testAccount });
	suspendAccountScope();
	await cancelResourceQueries();
	expect(getServerModel()).toBeUndefined();
	expect(
		serverQueryClient().getQueryData(accountResourceKey("model", scope)),
	).toEqual(model);
	expect(useWorkspaceStore.getState().draft).toBe(testAccount);
});

it("does not publish a retired account's late model result", async () => {
	let finish!: (value: Response) => void;
	const pending = new Promise<Response>((resolve) => {
		finish = resolve;
	});
	const headers = () => {
		const responseHeaders = new Headers({ "content-type": "application/json" });
		const resource = getAccountScope().resource?.id;
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
	owner("accounts/b");
	resetWorkspaceForResource();
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

it("retains only unsaved in-memory data for an explicit same-owner recovery", () => {
	useWorkspaceStore.setState({
		draft: testAccount,
		baseRevision: "a",
	});
	resetWorkspaceForResource({ preserveDraft: true });
	expect(useWorkspaceStore.getState().draft).toBe(testAccount);
	expect(useWorkspaceStore.getState().scope).toBeNull();
	resetWorkspaceForResource();
	expect(useWorkspaceStore.getState().draft).toBeNull();
});
