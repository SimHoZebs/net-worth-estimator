import { describe, expect, it } from "vitest";
import { FLOW_NODE_ID_EXTERNAL, type FlowEdge } from "../api/flows.ts";
import {
	aggregateFlowEdges,
	buildSankeyInput,
	describeFlowEdge,
	describeLaneTooltip,
	describeNodeTooltip,
	filterFlowEdges,
	hasFlowCycle,
	topLaneSources,
} from "./flowDiagram.ts";
import { graphFixture } from "./flowDiagramFixture.ts";

function edge(
	overrides: Partial<FlowEdge> & { from: string; to: string },
): FlowEdge {
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
	it("gives a large edge and its same-route group distinct lane ids", () => {
		const graph = graphFixture();
		const visible = aggregateFlowEdges(graph.edges);
		// The checking→savings route holds both a large transfer and a
		// grouped dust edge: shared route keys must not collide.
		expect(
			visible.filter(
				(item) => item.edge.from === "checking" && item.edge.to === "savings",
			).length,
		).toBe(2);
		const input = buildSankeyInput(graph, visible);
		const ids = input.lanes.map((lane) => lane.laneId);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("buildSankeyInput", () => {
	it("splits the external counterparty into source and destination rows", () => {
		const graph = graphFixture();
		const input = buildSankeyInput(graph, aggregateFlowEdges(graph.edges));
		const ids = input.nodes.map((node) => node.id);
		expect(ids).toContain("external:in");
		expect(ids).toContain("external:out");
		expect(ids).not.toContain(FLOW_NODE_ID_EXTERNAL);
		expect(ids).toContain("checking");
		// Six contract edges collapse to five lanes: the two dust
		// transfers fold into one grouped lane with a drilldown.
		expect(input.lanes).toHaveLength(5);
		const grouped = input.lanes.find((lane) => lane.aggregated);
		expect(grouped?.members).toHaveLength(2);
	});
	it("keeps signed amounts while endpoints stay structural", () => {
		const graph = graphFixture();
		const [first] = aggregateFlowEdges([
			{
				from: "checking",
				to: FLOW_NODE_ID_EXTERNAL,
				kind: "outflow",
				movement: "actual",
				amount: -300,
				sources: [],
			},
		]);
		const input = buildSankeyInput(graph, first ? [first] : []);
		expect(input.lanes[0]?.amount).toBe(-300);
		expect(input.lanes[0]?.source).toBe("checking");
		expect(input.lanes[0]?.target).toBe("external:out");
	});
	it("drops non-finite amounts from the layout input", () => {
		const graph = graphFixture();
		const [first] = aggregateFlowEdges([
			{
				from: "a",
				to: "b",
				kind: "transfer",
				movement: "actual",
				amount: Number.NaN,
				sources: [],
			},
		]);
		const input = buildSankeyInput(graph, first ? [first] : []);
		expect(input.lanes).toHaveLength(0);
		expect(input.nodes).toHaveLength(0);
	});
});

describe("hasFlowCycle", () => {
	const lane = (source: string, target: string) => ({ source, target });
	it("passes the acyclic fixture", () => {
		const graph = graphFixture();
		const input = buildSankeyInput(graph, aggregateFlowEdges(graph.edges));
		expect(hasFlowCycle(input.lanes)).toBe(false);
	});
	it("catches opposite transfers between two accounts", () => {
		expect(hasFlowCycle([lane("a", "b"), lane("b", "a")])).toBe(true);
	});
	it("catches longer loops", () => {
		expect(hasFlowCycle([lane("a", "b"), lane("b", "c"), lane("c", "a")])).toBe(
			true,
		);
	});
	it("catches a loop fed by an outside lane", () => {
		expect(
			hasFlowCycle([
				lane("feed", "a"),
				lane("a", "b"),
				lane("b", "c"),
				lane("c", "a"),
			]),
		).toBe(true);
	});
	it("passes chains and diamonds", () => {
		expect(
			hasFlowCycle([
				lane("in", "a"),
				lane("in", "b"),
				lane("a", "out"),
				lane("b", "out"),
			]),
		).toBe(false);
	});
});

describe("describeNodeTooltip", () => {
	it("names inflow and outflow totals with flow counts", () => {
		expect(
			describeNodeTooltip(
				"Everyday checking",
				[5000, 200],
				[300],
				(v) => `$${v}`,
			),
		).toBe(
			"Everyday checking: $5200 in across 2 flows, $300 out across 1 flow",
		);
	});
	it("weighs absolute flow and reads empty sides as zero", () => {
		expect(
			describeNodeTooltip("Outside accounts", [], [-50], (v) => `$${v}`),
		).toBe("Outside accounts: $0 in across 0 flows, $50 out across 1 flow");
	});
});

describe("describeLaneTooltip", () => {
	const short = edge({
		from: FLOW_NODE_ID_EXTERNAL,
		to: "checking",
		kind: "inflow",
		movement: "actual",
		amount: 300,
		sources: [
			{
				postingId: "a",
				date: "2026-01-05",
				sequence: 0,
				requestedAmount: 100,
				realizedAmount: 100,
			},
			{
				postingId: "b",
				date: "2026-02-05",
				sequence: 0,
				requestedAmount: 200,
				realizedAmount: 200,
			},
		],
	});
	it("lists every source transaction on short lists", () => {
		expect(
			describeLaneTooltip(
				short,
				(id) => id,
				(v) => `$${v}`,
				(d) => d,
			),
		).toBe(
			"Money in of $300 from external to checking (recorded) Transactions: 2026-02-05 $200 · 2026-01-05 $100.",
		);
	});
	it("caps long lists at the largest transactions and points at the inspector", () => {
		const long = edge({
			...short,
			amount: 1000,
			sources: [1, 2, 3, 4, 5].map((n) => ({
				postingId: `p${n}`,
				date: `2026-0${n}-01`,
				sequence: 0,
				requestedAmount: n * 100,
				realizedAmount: n * 100,
			})),
		});
		expect(topLaneSources(long)).toHaveLength(3);
		expect(topLaneSources(long)[0]?.postingId).toBe("p5");
		expect(
			describeLaneTooltip(
				long,
				(id) => id,
				(v) => `$${v}`,
				(d) => d,
			),
		).toBe(
			"Money in of $1000 from external to checking (recorded) Top transactions: 2026-05-01 $500 · 2026-04-01 $400 · 2026-03-01 $300 · +2 more — select this flow to inspect all 5.",
		);
	});
	it("falls back to the bare sentence without sources", () => {
		expect(
			describeLaneTooltip(
				edge({ from: "a", to: "b", amount: 50, sources: [] }),
				(id) => id,
				(v) => `$${v}`,
				(d) => d,
			),
		).toBe("Transfer of $50 from a to b (recorded)");
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
