import { beforeEach, expect, it } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { setServerModelOnly } from "../mocks/workspace.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import { transactionRemovalNeedsProjectionRefresh } from "./transactionCache.ts";
import {
	type EvaluationSummary,
	userResourceKey,
} from "./workspaceResources.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});

function editCachedEvaluations(
	edit: (evaluations: EvaluationSummary["evaluations"]) => void,
) {
	const key = userResourceKey("eval-summary");
	const cached = serverQueryClient().getQueryData<EvaluationSummary>(key);
	if (!cached) throw new Error("The test summary is missing.");
	const evaluations = structuredClone(cached.evaluations);
	edit(evaluations);
	serverQueryClient().setQueryData(key, { ...cached, evaluations });
}

function editCachedRows(edit: (rows: {
	checkpoints: { AccountId: string; Balance: number; observedAt: number }[];
	schedules: { id: string }[];
	transactions: { id: string }[];
}) => void) {
	const checkpointsKey = [...userResourceKey("checkpoints"), "", "", ""];
	const schedulesKey = [...userResourceKey("rules"), ""];
	const transactionsKey = [...userResourceKey("transactions"), ""];
	const cachedCheckpoints = serverQueryClient().getQueryData<{
		checkpoints: { AccountId: string; Balance: number; observedAt: number }[];
	}>(checkpointsKey);
	const cachedSchedules = serverQueryClient().getQueryData<{
		schedules: { id: string }[];
	}>(schedulesKey);
	const cachedTransactions = serverQueryClient().getQueryData<{
		transactions: { id: string }[];
	}>(transactionsKey);
	if (!cachedCheckpoints || !cachedSchedules || !cachedTransactions)
		throw new Error("The test rows are missing.");
	const copy = structuredClone({
		checkpoints: cachedCheckpoints.checkpoints,
		schedules: cachedSchedules.schedules,
		transactions: cachedTransactions.transactions,
	});
	edit(copy);
	serverQueryClient().setQueryData(checkpointsKey, {
		...cachedCheckpoints,
		checkpoints: copy.checkpoints,
	});
	serverQueryClient().setQueryData(schedulesKey, {
		...cachedSchedules,
		schedules: copy.schedules,
	});
	serverQueryClient().setQueryData(transactionsKey, {
		...cachedTransactions,
		transactions: copy.transactions,
	});
}

it("leaves projections alone when no consumer names the transaction", () => {
	setServerModelOnly();
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(false);
});

it("refreshes projections when a fulfillment evaluation names the transaction", () => {
	setServerModelOnly();
	editCachedEvaluations((evaluations) => {
		evaluations.transactionFulfillment = [
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
	editCachedEvaluations((evaluations) => {
		evaluations.financialIndependence = [
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
	editCachedEvaluations((evaluations) => {
		evaluations.whatIf = [
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
	editCachedEvaluations((evaluations) => {
		evaluations.financialIndependence = [
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
	editCachedEvaluations((evaluations) => {
		evaluations.whatIf = [
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
	editCachedRows((rows) => {
		rows.checkpoints = [];
		rows.schedules = [];
		rows.transactions = [{ ...rows.transactions[0]!, id: "vanished-hold" }];
	});
	expect(transactionRemovalNeedsProjectionRefresh("vanished-hold")).toBe(true);
});
