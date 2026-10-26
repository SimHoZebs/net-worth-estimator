import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	getResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import type { FinancialModelResponse } from "../api/index.ts";
import {
	resetWorkspaceForResource,
	resetWorkspaceStore,
	useWorkspaceStore,
	type RemoteApiClient,
} from "./workspaceStore.ts";
import {
	getServerModel,
	modelOptions,
	workspaceResourceKey,
} from "./workspaceResources.ts";
import {
	cancelResourceQueries,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import { setServerModelFixture } from "../test/workspace.ts";
import { testPlan } from "../test/plan.ts";

function owner(id: string) {
	acceptResourceScope(
		{
			apiBaseUrl: "http://localhost",
			resource: {
				id,
				kind: "private",
				permissions: ["plan:read", "plan:write"],
			},
			subject: id,
		},
		suspendResourceScope(),
	);
}
beforeEach(() => {
	owner("plans/a");
	resetWorkspaceStore();
	resetServerQueryCache();
});
afterEach(() => {
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendResourceScope();
});

it("retains completed Query data during verification without exposing it under pending scope", async () => {
	const model = setServerModelFixture();
	const scope = getResourceScope();
	useWorkspaceStore.setState({ draft: testPlan, volatile: true });
	suspendResourceScope();
	await cancelResourceQueries();
	expect(getServerModel()).toBeUndefined();
	expect(
		serverQueryClient().getQueryData(workspaceResourceKey("model", scope)),
	).toEqual(model);
	expect(useWorkspaceStore.getState().draft).toBe(testPlan);
});

it("does not publish a retired account's late model result", async () => {
	let finish!: (response: FinancialModelResponse) => void;
	const api = {
		getStatus: vi.fn(async () => ({ readOnly: false })),
		getModel: vi.fn(
			() =>
				new Promise<FinancialModelResponse>((resolve) => {
					finish = resolve;
				}),
		),
	} as unknown as RemoteApiClient;
	const old = serverQueryClient()
		.fetchQuery(modelOptions(api))
		.catch(() => {});
	owner("plans/b");
	resetWorkspaceForResource();
	const current = setServerModelFixture(undefined, { revision: "b" });
	finish({ document: null, revision: "private-a", issues: [] });
	await old;
	expect(getServerModel()).toEqual(current);
});

it("retains only unsaved volatile data for an explicit same-owner recovery", () => {
	useWorkspaceStore.setState({
		draft: testPlan,
		volatile: true,
		baseRevision: "a",
	});
	resetWorkspaceForResource({ preserveVolatile: true });
	expect(useWorkspaceStore.getState().draft).toBe(testPlan);
	expect(useWorkspaceStore.getState().scope).toBeNull();
	resetWorkspaceForResource();
	expect(useWorkspaceStore.getState().draft).toBeNull();
});
