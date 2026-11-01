import { describe, expect, it } from "vitest";
import { FLOW_NODE_ID_EXTERNAL, type FlowEdge } from "../api/flows.ts";
import {
	aggregateFlowEdges,
	describeFlowEdge,
	diagramEdgeId,
	filterFlowEdges,
	layoutFlowDiagram,
} from "./flowDiagram.ts";
import { graphFixture } from "./flowDiagramFixture.ts";

function edge(overrides: Partial<FlowEdge> & { from: string; to: string }): FlowEdge {
	return {
		kind: "transfer",
		movement: "actual",
		amount: 100,
		sources: [],
		...overrides,
	};
}

describe("filterFlowEdges", () => {
	const graph = graphFixture();
	it("keeps every edge without filters", () => {
		expect(
			filterFlowEdges(graph, { movement: "all", accountId: null }),
		).toHaveLength(graph.edges.length);
	});
	it("narrows to one movement class", () => {
		const actual = filterFlowEdges(graph, {
			movement: "actual",
			accountId: null,
		});
		expect(actual.length).toBeGreaterThan(0);
		expect(actual.every((item) => item.movement === "actual")).toBe(true);
	});
	it("focuses the subgraph touching one account", () => {
		const focused = filterFlowEdges(graph, {
			movement: "all",
			accountId: "checking",
		});
		expect(focused.length).toBeGreaterThan(0);
		expect(
			focused.every(
				(item) => item.from === "checking" || item.to === "checking",
			),
		).toBe(true);
	});
});

describe("aggregateFlowEdges", () => {
	it("passes large edges through untouched", () => {
		const edges = [
			edge({ from: "a", to: "b", amount: 1000 }),
			edge({ from: "a", to: "b", amount: 900 }),
		];
		const result = aggregateFlowEdges(edges);
		expect(result).toHaveLength(2);
		expect(result.every((item) => !item.aggregated)).toBe(true);
	});
	it("groups dust edges and keeps their sources for drilldown", () => {
		const edges = [
			edge({ from: "a", to: "b", amount: 1000 }),
			edge({
				from: "a",
				to: "b",
				amount: 1,
				sources: [
					{
						postingId: "p1",
						date: "2026-02-01",
						sequence: 0,
						requestedAmount: 1,
						realizedAmount: 1,
					},
				],
			}),
			edge({
				from: "a",
				to: "b",
				amount: 2,
				sources: [
					{
						postingId: "p2",
						date: "2026-03-01",
						sequence: 0,
						requestedAmount: 2,
						realizedAmount: 2,
					},
				],
			}),
		];
		const result = aggregateFlowEdges(edges);
		expect(result).toHaveLength(2);
		const grouped = result.find((item) => item.aggregated);
		expect(grouped?.edge.amount).toBe(3);
		expect(grouped?.edge.sources).toHaveLength(2);
		expect(grouped?.members).toHaveLength(2);
	});
	it("keeps a lone small edge ungrouped", () => {
		const edges = [
			edge({ from: "a", to: "b", amount: 1000 }),
			edge({ from: "a", to: "b", amount: 1 }),
		];
		const result = aggregateFlowEdges(edges);
		expect(result).toHaveLength(2);
		expect(result.every((item) => !item.aggregated)).toBe(true);
	});
	it("gives a large edge and its same-route group distinct identities", () => {
		const graph = graphFixture();
		const visible = aggregateFlowEdges(graph.edges);
		// The checking→savings route holds both a large transfer and a
		// grouped dust edge: shared route keys must not collide.
		expect(
			visible.filter(
				(item) => item.edge.from === "checking" && item.edge.to === "savings",
			).length,
		).toBe(2);
		const ids = visible.map((item, index) => diagramEdgeId(item, index));
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("layoutFlowDiagram", () => {
	it("places inflows left, accounts middle, outflows right", () => {
		const graph = graphFixture();
		const diagram = layoutFlowDiagram(
			graph,
			aggregateFlowEdges(graph.edges),
		);
		const columns = new Map(diagram.nodes.map((node) => [node.id, node.column]));
		expect(columns.get(`${FLOW_NODE_ID_EXTERNAL}:in`)).toBe(0);
		expect(columns.get(`${FLOW_NODE_ID_EXTERNAL}:out`)).toBe(2);
		expect(columns.get("checking")).toBe(1);
		// Six contract edges collapse to five diagram edges: the two dust
		// transfers fold into one grouped edge with a drilldown.
		expect(diagram.edges.length).toBe(5);
		expect(diagram.edges.some((item) => item.aggregated)).toBe(true);
		for (const item of diagram.edges) {
			expect(item.path).toMatch(/^M /);
			expect(item.thickness).toBeGreaterThan(0);
		}
	});
	it("scales thickness with the amount", () => {
		const graph = graphFixture();
		const diagram = layoutFlowDiagram(
			graph,
			aggregateFlowEdges(graph.edges),
			{ minThickness: 2, maxThickness: 20 },
		);
		const thickest = diagram.edges.reduce((a, b) =>
			Math.abs(a.edge.amount) >= Math.abs(b.edge.amount) ? a : b,
		);
		const thinnest = diagram.edges.reduce((a, b) =>
			Math.abs(a.edge.amount) <= Math.abs(b.edge.amount) ? a : b,
		);
		expect(thickest.thickness).toBeGreaterThanOrEqual(thinnest.thickness);
		expect(thickest.thickness).toBeLessThanOrEqual(20);
		expect(thinnest.thickness).toBeGreaterThanOrEqual(2);
	});
});

describe("describeFlowEdge", () => {
	it("names the route, amount, and movement in plain words", () => {
		const text = describeFlowEdge(
			edge({
				from: FLOW_NODE_ID_EXTERNAL,
				to: "checking",
				kind: "inflow",
				movement: "projected",
				amount: 250,
			}),
			(id) => (id === FLOW_NODE_ID_EXTERNAL ? "Outside accounts" : id),
			(value) => `$${value}`,
		);
		expect(text).toBe(
			"Money in of $250 from Outside accounts to checking (planned)",
		);
	});
});
