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

it("leaves projections alone when no consumer names the transaction", () => {
	setServerModelOnly();
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(false);
});

it("refreshes projections when a fulfillment evaluation names the transaction", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.transactionFulfillment = [
			{
				instanceId: "fulfillment",
				name: "Fulfillment",
				enabled: true,
				config: { transactionIds: ["vanished-hold"] },
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a financial independence source names the transaction", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.financialIndependence = [
			{
				instanceId: "independence",
				name: "Independence",
				enabled: true,
				config: {
					sources: [
						{
							type: "cashflow",
							transactionId: "vanished-hold",
							included: true,
						},
					],
					continuingTransactionIds: [],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a what-if scenario names the transaction", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.whatIf = [
			{
				instanceId: "scenario",
				name: "Scenario",
				enabled: true,
				config: { disabledTransactionIds: ["vanished-hold"] },
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when continuing transactions name the transaction", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.financialIndependence = [
			{
				instanceId: "independence",
				name: "Independence",
				enabled: true,
				config: {
					sources: [],
					continuingTransactionIds: ["vanished-hold"],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when a what-if addition names the transaction", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.evaluations.whatIf = [
			{
				instanceId: "scenario",
				name: "Scenario",
				enabled: true,
				config: {
					disabledTransactionIds: [],
					addedTransactions: [{ id: "vanished-hold" }],
				},
			},
		];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});

it("refreshes projections when the transaction supplies the start date", () => {
	setServerModelOnly();
	editCachedModel((model) => {
		model.checkpoints = [];
		model.schedules = [];
		model.transactions = [{ ...model.transactions[0]!, id: "vanished-hold" }];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});
