import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../test/resource.ts";
import { testPlan } from "../test/plan.ts";
import {
	getServerModel,
	modelOptions,
	workspaceResourceKey,
} from "./workspaceResources.ts";
import { serverQueryClient, resetServerQueryCache } from "./serverQuery.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
	type RemoteApiClient,
} from "./workspaceStore.ts";
import { setServerModelFixture } from "../test/workspace.ts";
import type { FinancialModelResponse } from "../api/index.ts";

beforeEach(() => {
	acceptTestResource();
	resetWorkspaceStore();
	resetServerQueryCache();
});

function client() {
	return {
		getModel: vi.fn(async (): Promise<FinancialModelResponse> => ({
			document: null,
			revision: "current",
			issues: [],
		})),
		getStatus: vi.fn(async () => ({ readOnly: false })),
	};
}

describe("direct Query ownership", () => {
	it("deduplicates reads without a workspace request engine", async () => {
		const api = client();
		const options = modelOptions(api as unknown as RemoteApiClient);
		await Promise.all([
			serverQueryClient().fetchQuery(options),
			serverQueryClient().fetchQuery(options),
		]);
		expect(api.getModel).toHaveBeenCalledOnce();
		expect(getServerModel()?.revision).toBe("current");
		expect(useWorkspaceStore.getState()).not.toHaveProperty("engine");
		expect(useWorkspaceStore.getState()).not.toHaveProperty("loading");
		expect(useWorkspaceStore.getState()).not.toHaveProperty("serverDocument");
	});
	it("removes server data independently of the local draft", () => {
		setServerModelFixture();
		useWorkspaceStore.setState({
			draft: testPlan,
			baseline: testPlan,
			baseRevision: "base",
		});
		serverQueryClient().removeQueries({
			queryKey: workspaceResourceKey("model"),
			exact: true,
		});
		expect(getServerModel()).toBeUndefined();
		expect(useWorkspaceStore.getState().draft).toBe(testPlan);
		expect(useWorkspaceStore.getState().baseRevision).toBe("base");
	});
	it("does not let a canceled request overwrite a newer same-resource result", async () => {
		const api = client();
		let finish!: (response: FinancialModelResponse) => void;
		api.getModel.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const options = modelOptions(api as unknown as RemoteApiClient);
		const old = serverQueryClient()
			.fetchQuery(options)
			.catch((error: unknown) => error);
		await serverQueryClient().cancelQueries({ queryKey: options.queryKey });
		expect(await old).toBeInstanceOf(Error);
		await serverQueryClient().fetchQuery(options);
		finish({ document: null, revision: "retired", issues: [] });
		await Promise.resolve();
		expect(getServerModel()?.revision).toBe("current");
	});
});
