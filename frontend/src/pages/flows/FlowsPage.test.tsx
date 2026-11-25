import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_NODE_ID_EXTERNAL, type FlowGraph } from "../../api/flows.ts";
import { FlowsPage } from "./FlowsPage.tsx";

const flowGraphMock = vi.hoisted(() => vi.fn());

vi.mock("../../state/useFlowGraph.ts", () => ({
	useFlowGraph: flowGraphMock,
}));
vi.mock("./FlowFilters.tsx", () => ({ FlowFilters: () => null }));
vi.mock("./FlowSankey.tsx", () => ({
	FlowSankey: () => <div>Money-flow diagram</div>,
}));
vi.mock("./FlowEdgePanel.tsx", () => ({ FlowEdgePanel: () => null }));

function graph(): FlowGraph {
	return {
		startDate: "2026-01-01",
		endDate: "2026-01-31",
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
			{
				id: "new-account",
				name: "New account",
				external: false,
				enabled: true,
				inflow: 0,
				outflow: 0,
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
						sequence: 0,
						requestedAmount: 40,
						realizedAmount: 40,
					},
				],
			},
		],
		unmatched: [
			{
				transactionId: "tx-2",
				date: "2026-01-03",
				sequence: 1,
				realizedAmount: 25,
			},
		],
		coverage: {
			observedAccounts: ["checking"],
			unobservedAccounts: ["new-account"],
		},
		totals: {
			actual: { inflow: 100, outflow: 40, transfer: 0 },
			projected: { inflow: 0, outflow: 0, transfer: 0 },
			unmatched: 25,
		},
		reconciliation: {
			windowEvents: 2,
			classifiedEvents: 1,
			unmatchedEvents: 1,
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

beforeEach(() => {
	flowGraphMock.mockReset();
	flowGraphMock.mockReturnValue({
		data: graph(),
		isPending: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
	});
});

describe("flows without balance corrections", () => {
	it("keeps unmatched and missing-starting-observation coverage without correction UI", () => {
		render(<FlowsPage />);
		expect(screen.getByText(/Partial coverage: 1 account has no/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Table" }));
		expect(
			screen.getByText(/\$25 moved without a recorded path \(1 transaction\)/),
		).toBeTruthy();
		expect(
			screen.getByText(/no starting balance observation: New account/),
		).toBeTruthy();
		expect(
			screen.queryByText(/correction|balance checks|unobserved money/i),
		).toBeNull();
	});
});
