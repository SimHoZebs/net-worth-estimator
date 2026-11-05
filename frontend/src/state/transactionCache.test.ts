import { beforeEach, expect, it } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerModelOnly } from "../mocks/workspace.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import { transactionRemovalNeedsProjectionRefresh } from "./transactionCache.ts";
import { type ServerModel, userResourceKey } from "./workspaceResources.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});

function editCachedModel(
	edit: (model: NonNullable<ServerModel["model"]>) => void,
) {
	const key = userResourceKey("model");
	const cached = serverQueryClient().getQueryData<ServerModel>(key);
	if (!cached?.model) throw new Error("The test model is missing.");
	const model = structuredClone(cached.model);
	edit(model);
	serverQueryClient().setQueryData(key, { ...cached, model });
}

it("leaves projections alone when no consumer names the posting", () => {
	setServerModelOnly();
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(false);
});

it("refreshes projections when a fulfillment evaluation names the posting", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.postingFulfillment = [
			{
				instanceId: "fulfillment",
				name: "Fulfillment",
				enabled: true,
				config: { postingIds: ["vanished-hold"] },
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a financial independence source names the posting", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.financialIndependence = [
			{
				instanceId: "independence",
				name: "Independence",
				enabled: true,
				config: {
					sources: [
						{ type: "cashflow", postingId: "vanished-hold", included: true },
					],
					continuingPostingIds: [],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a what-if scenario names the posting", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.whatIf = [
			{
				instanceId: "scenario",
				name: "Scenario",
				enabled: true,
				config: { disabledPostingIds: ["vanished-hold"] },
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when continuing postings name the posting", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.financialIndependence = [
			{
				instanceId: "independence",
				name: "Independence",
				enabled: true,
				config: {
					sources: [],
					continuingPostingIds: ["vanished-hold"],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a what-if addition names the posting", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.whatIf = [
			{
				instanceId: "scenario",
				name: "Scenario",
				enabled: true,
				config: {
					disabledPostingIds: [],
					addedPostings: [{ id: "vanished-hold" }],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when the posting supplies the start date", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.checkpoints = [];
		model.schedules = [];
		model.postings = [{ ...model.postings[0]!, id: "vanished-hold" }];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});
