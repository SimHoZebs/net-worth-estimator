import { describe, expect, it, vi } from "vitest";
import {
	FLOW_NODE_ID_EXTERNAL,
	type FlowGraph,
	requestFlowGraph,
} from "./flows.ts";
import { waypointFetch } from "./waypoint-fetch.ts";

vi.mock("./waypoint-fetch.ts", () => ({
	waypointFetch: vi.fn(),
}));

const fetchMock = vi.mocked(waypointFetch);

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
		edges: [],
		unmatched: [],
		unobserved: [],
		coverage: { observedAccounts: ["checking"], unobservedAccounts: [] },
		totals: {
			actual: { inflow: 100, outflow: 40, transfer: 0 },
			projected: { inflow: 0, outflow: 0, transfer: 0 },
			unmatched: 0,
			unobserved: 0,
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
			correctionsCount: 0,
			unobservedSum: 0,
			reconciled: true,
		},
	};
}

describe("requestFlowGraph", () => {
	it("resolves the graph from the flows response", async () => {
		const expected = graph();
		fetchMock.mockResolvedValueOnce({ data: { graph: expected } });
		const result = await requestFlowGraph({
			settings: {
				fallbackProjectionStartDate: "2026-01-01",
				horizonYears: 1,
				evaluations: {},
			} as never,
			range: { startDate: "2026-01-01", endDate: "2026-12-31" },
		});
		expect(result).toEqual(expected);
		expect(fetchMock).toHaveBeenCalledWith(
			"/v1/flows",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("surfaces the server error message", async () => {
		fetchMock.mockResolvedValueOnce({ data: { error: "no model" } });
		await expect(
			requestFlowGraph({
				settings: {} as never,
				range: { endDate: "2026-12-31" },
			}),
		).rejects.toThrow("no model");
	});

	it("joins error-severity issues when no graph arrives", async () => {
		fetchMock.mockResolvedValueOnce({
			data: {
				issues: [
					{
						severity: "error",
						code: "bad",
						message: "invalid model",
						path: [],
					},
				],
			},
		});
		await expect(
			requestFlowGraph({
				settings: {} as never,
				range: { endDate: "2026-12-31" },
			}),
		).rejects.toThrow("invalid model");
	});

	it("rejects a payload missing the contract keys", async () => {
		fetchMock.mockResolvedValueOnce({
			data: { graph: { nodes: [], edges: [] } },
		});
		await expect(
			requestFlowGraph({
				settings: {} as never,
				range: { endDate: "2026-12-31" },
			}),
		).rejects.toThrow("no money-flow graph");
	});
});
