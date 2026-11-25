import { describe, expect, expectTypeOf, it } from "vitest";
import {
	FLOW_EXTERNAL_LABEL,
	FLOW_NODE_ID_EXTERNAL,
	type FlowEdge,
	flowNodeById,
	flowNodeName,
	isFlowGraph,
	readFlowGraph,
	type FlowGraph,
} from "./flows.ts";
import { readFlowGraphResponse } from "../state/useFlowGraph.ts";
import type {
	FlowCoverage as GeneratedFlowCoverage,
	FlowEdge as GeneratedFlowEdge,
	FlowGraph as GeneratedFlowGraph,
	FlowsOutputBody,
} from "./generated/model/index.ts";

function graph(): FlowGraph {
	return {
		startDate: "2026-01-01",
		endDate: "2026-12-31",
		nodes: [
			{
				id: "checking",
				name: "Checking",
				external: false,
				enabled: true,
				inflow: 100,
				outflow: 40,
			},
			{
				id: FLOW_NODE_ID_EXTERNAL,
				name: "External",
				external: true,
				enabled: true,
				inflow: 40,
				outflow: 100,
			},
		],
		edges: [
			{
				from: "checking",
				to: FLOW_NODE_ID_EXTERNAL,
				kind: "outflow",
				movement: "actual",
				amount: 40,
				sources: [
					{
						transactionId: "tx-1",
						date: "2026-01-02",
						sequence: 1,
						requestedAmount: 40,
						realizedAmount: 40,
					},
				],
			},
		],
		unmatched: [],
		coverage: { observedAccounts: ["checking"], unobservedAccounts: [] },
		totals: {
			actual: { inflow: 100, outflow: 40, transfer: 0 },
			projected: { inflow: 0, outflow: 0, transfer: 0 },
			unmatched: 0,
		},
		reconciliation: {
			windowEvents: 2,
			classifiedEvents: 2,
			unmatchedEvents: 0,
			eventsInflow: 100,
			eventsOutflow: 40,
			eventsTransfer: 0,
			edgesInflow: 100,
			edgesOutflow: 40,
			edgesTransfer: 0,
			reconciled: true,
		},
	};
}

function response(graphValue: unknown): FlowsOutputBody {
	return { graph: graphValue as FlowsOutputBody["graph"] };
}

describe("flow payload key parity", () => {
	it("keeps the generated keys while narrowing their values", () => {
		expectTypeOf<keyof FlowGraph>().toEqualTypeOf<keyof GeneratedFlowGraph>();
		expectTypeOf<keyof FlowEdge>().toEqualTypeOf<keyof GeneratedFlowEdge>();
		expectTypeOf<keyof import("./flows.ts").FlowCoverage>().toEqualTypeOf<
			keyof GeneratedFlowCoverage
		>();
	});
});

describe("isFlowGraph", () => {
	it("accepts a full graph and narrows generated nullable arrays", () => {
		const payload = graph();
		const nullable = {
			...payload,
			edges: null,
			unmatched: null,
			coverage: { observedAccounts: null, unobservedAccounts: null },
		};
		expect(isFlowGraph(nullable)).toBe(true);
		expect(readFlowGraph(nullable)).toEqual({
			...payload,
			edges: [],
			unmatched: [],
			coverage: { observedAccounts: [], unobservedAccounts: [] },
		});
	});

	it("accepts graphs without correction fields and keeps unmatched and coverage", () => {
		const result = readFlowGraph(graph());
		expect(result).not.toHaveProperty("unobserved");
		expect(result.unmatched).toHaveLength(0);
		expect(result.coverage.unobservedAccounts).toEqual([]);
	});

	it("rejects a payload missing the contract keys", () => {
		expect(isFlowGraph({ nodes: [], edges: [] })).toBe(false);
	});

	it("rejects unknown edge kinds and movements", () => {
		const payload = graph();
		expect(
			isFlowGraph({
				...payload,
				edges: [{ ...payload.edges[0]!, kind: "mystery" }],
			}),
		).toBe(false);
		expect(
			isFlowGraph({
				...payload,
				edges: [{ ...payload.edges[0]!, movement: "maybe" }],
			}),
		).toBe(false);
	});

	it("rejects null and non-numeric scalar fields", () => {
		const payload = graph();
		expect(
			isFlowGraph({
				...payload,
				reconciliation: { ...payload.reconciliation, windowEvents: null },
			}),
		).toBe(false);
		expect(isFlowGraph({ ...payload, endDate: null })).toBe(false);
	});

	it("rejects a non-object payload", () => {
		expect(isFlowGraph(null)).toBe(false);
		expect(isFlowGraph("graph")).toBe(false);
	});
});

describe("flow node helpers", () => {
	it("finds nodes and labels the external counterparty in plain language", () => {
		const payload = graph();
		expect(flowNodeById(payload, "checking")?.name).toBe("Checking");
		expect(flowNodeName(payload, "checking")).toBe("Checking");
		expect(flowNodeName(payload, FLOW_NODE_ID_EXTERNAL)).toBe(
			FLOW_EXTERNAL_LABEL,
		);
		expect(flowNodeName(payload, "unknown")).toBe("unknown");
	});
});

describe("readFlowGraphResponse", () => {
	it("surfaces the server error message", () => {
		expect(() => readFlowGraphResponse({ error: "no model" })).toThrow(
			"no model",
		);
	});

	it("joins error-severity issues when no graph arrives", () => {
		expect(() =>
			readFlowGraphResponse({
				issues: [
					{
						severity: "error",
						code: "bad",
						message: "invalid model",
						path: [],
					},
				],
			}),
		).toThrow("invalid model");
	});

	it("reports an absent graph", () => {
		expect(() => readFlowGraphResponse({})).toThrow("no money-flow graph");
	});

	it("produces a user-facing error for a malformed graph", () => {
		expect(() =>
			readFlowGraphResponse(response({ nodes: [], edges: [] })),
		).toThrow("invalid money-flow graph");
	});
});
