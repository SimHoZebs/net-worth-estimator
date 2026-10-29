import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import { displayPlanToBackendDocument } from "../api/adapter.ts";
import type {
	DeterministicProjectionRequest,
	EvaluationResultTables,
	ProjectionResult,
} from "../api/contracts.ts";
import { testPlan } from "../mocks/plan.ts";
import {
	PURCHASE_EVALUATIONS,
	PURCHASE_EVALUATION_ID,
	purchaseEvaluationResult,
	purchaseSchedule,
} from "./purchaseEvaluation.ts";
import {
	projectionStartDate,
	useRemoteProjection,
} from "./useRemoteProjection.ts";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
beforeEach(acceptTestResource);

function resultFixture(evaluations: EvaluationResultTables): ProjectionResult {
	return {
		timeline: { rows: [] },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: null,
			projectionStartDate: "2026-01-31",
		},
		summary: { currentNetWorth: 0, finalNetWorth: 0 },
		evaluations,
	};
}

describe("isolated purchase evaluation", () => {
	it("never derives a baseline start date from a planned purchase", () => {
		const document = displayPlanToBackendDocument({
			...testPlan,
			plannedPurchases: [
				{
					id: "purchase",
					name: "Purchase",
					amount: 50,
					fromId: "checking",
					startDate: "2020-01-01",
					enabled: true,
					readOnly: false,
				},
			],
		}).document;
		document.checkpoints = [];
		document.recurrenceRules = [];
		// Compat wire shape: the slice persists as a legacy purchase posting.
		expect(
			document.postings.find((item) => item.id === "purchase"),
		).toMatchObject({
			id: "purchase",
			sourceAccountId: "checking",
			purchase: { priority: 0 },
		});
		const posting = {
			id: "real",
			name: "Real",
			sourceAccountId: "checking",
			destinations: null,
			amount: { resolver: "expression", config: { expression: "50" } },
			enabled: true,
			postedTime: 1769904000,
			transactionTime: 1769904000,
		};
		const legacyPurchase = {
			...document.postings.find((item) => item.id === "purchase")!,
			postedTime: 1577836800,
			transactionTime: 1577836800,
		};
		document.postings = [legacyPurchase, posting];
		expect(projectionStartDate(document)).toBe("2026-02-01");
		// Standalone rows never feed the fallback either.
		document.plannedPurchases = [
			{
				id: "row",
				name: "Row",
				fundingAccountId: "checking",
				cost: 10,
				earliestDate: "2020-01-01",
				enabled: true,
				priority: 0,
			},
		];
		expect(projectionStartDate(document)).toBe("2026-02-01");
	});
	it("maps only the evaluation schedule, including explicitly unfunded items", () => {
		expect(
			purchaseSchedule({
				purchases: [
					{ postingId: "laptop", date: "2027-02-05", amount: 500 },
					{ postingId: "chair", date: null, amount: 150 },
				],
			}),
		).toEqual({
			purchases: [
				{ postingId: "laptop", date: "2027-02-05", amount: 500 },
				{ postingId: "chair", date: null, amount: 150 },
			],
		});
		expect(
			purchaseSchedule({ purchases: [{ postingId: "laptop", amount: 500 }] }),
		).toBeNull();
	});

	it("reports missing or failed evaluation evidence instead of labeling purchases unfunded", () => {
		const tables: EvaluationResultTables = {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
		};
		expect(() =>
			purchaseEvaluationResult(tables, PURCHASE_EVALUATIONS),
		).toThrow("returned no schedule");
		tables.plannedPurchases = [
			{
				instanceId: PURCHASE_EVALUATION_ID,
				name: "Purchases",
				status: "warning",
				deterministic: null,
				probabilistic: null,
				diagnostics: [
					{ code: "error", severity: "error", message: "Simulation failed" },
				],
			},
		];
		expect(() =>
			purchaseEvaluationResult(tables, PURCHASE_EVALUATIONS),
		).toThrow("Simulation failed");
		expect(purchaseEvaluationResult(tables, undefined)).toBeNull();
	});

	it("separates baseline and evaluation cache entries and recalculates on priority changes", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client: queryClient }, children);
		const document = displayPlanToBackendDocument({
			...testPlan,
			plannedPurchases: [
				{
					id: "laptop",
					name: "Laptop",
					amount: 500,
					fromId: "checking",
					startDate: "2026-02-01",
					enabled: true,
					readOnly: false,
				},
			],
		}).document;
		const before = JSON.stringify(document);
		const deterministicCalls: unknown[] = [];
		const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
			const headers = new Headers({ "content-type": "application/json" });
			const resource = getResourceScope().resource?.id;
			if (resource) headers.set("Waypoint-Resource", resource);
			if (String(url).endsWith("/v1/projections/deterministic")) {
				const request = JSON.parse(
					String(init?.body ?? "{}"),
				) as DeterministicProjectionRequest;
				deterministicCalls.push(request);
				const evaluations: EvaluationResultTables = {
					financialIndependence: [],
					netWorthThreshold: [],
					accountBalance: [],
					postingFulfillment: [],
				};
				if (request.settings.evaluations.plannedPurchases?.length)
					evaluations.plannedPurchases = [
						{
							instanceId: PURCHASE_EVALUATION_ID,
							name: "Purchases",
							status: "satisfied",
							probabilistic: null,
							diagnostics: [],
							deterministic: {
								purchases: [
									{
										postingId: "laptop",
										date:
											request.document?.postings.find(
												(item) => item.id === "laptop",
											)?.purchase?.priority === 0
												? "2026-02-01"
												: "2026-03-01",
										amount: 500,
									},
								],
							},
						},
					];
				return new Response(
					JSON.stringify({ result: resultFixture(evaluations), issues: [] }),
					{ headers },
				);
			}
			throw new Error(`Unexpected fetch: ${String(url)}`);
		});
		vi.stubGlobal("fetch", fetcher);
		const rendered = renderHook(
			({ active }) => ({
				baseline: useRemoteProjection({
					document: active,
					years: 1,
					ranges: false,
				}),
				purchases: useRemoteProjection({
					document: active,
					years: 1,
					ranges: false,
					evaluations: PURCHASE_EVALUATIONS,
				}),
			}),
			{ wrapper, initialProps: { active: document } },
		);
		await waitFor(() => expect(deterministicCalls).toHaveLength(2));
		await waitFor(() =>
			expect(rendered.result.current.purchases.base).toMatchObject({
				plannedPurchases: { purchases: [{ date: "2026-02-01" }] },
			}),
		);
		expect(rendered.result.current.baseline.base).toMatchObject({
			plannedPurchases: null,
		});
		expect(JSON.stringify(document)).toBe(before);
		const changed = structuredClone(document);
		changed.postings.find((item) => item.id === "laptop")!.purchase!.priority =
			1;
		rendered.rerender({ active: changed });
		await waitFor(() =>
			expect(rendered.result.current.purchases.base).toMatchObject({
				plannedPurchases: { purchases: [{ date: "2026-03-01" }] },
			}),
		);
		expect(
			fetcher.mock.calls.filter(([url]) =>
				String(url).endsWith("/v1/projections/stochastic"),
			),
		).toHaveLength(0);
		rendered.unmount();
		queryClient.clear();
	});
});
