import {
	FLOW_EXTERNAL_LABEL,
	FLOW_NODE_ID_EXTERNAL,
	type FlowEdge,
	type FlowGraph,
	type FlowKind,
	type FlowMovement,
} from "../api/flows.ts";

export type MovementFilter = "all" | FlowMovement;

export interface FlowViewFilters {
	movement: MovementFilter;
	/** Account node id to focus, or null for the whole graph. */
	accountId: string | null;
}

export const ALL_MOVEMENTS: MovementFilter = "all";

/** Edges surviving the movement and account filters. The account filter
 * focuses the subgraph touching that account; window totals still describe
 * the whole graph and the view labels the focus explicitly. */
export function filterFlowEdges(
	graph: FlowGraph,
	filters: FlowViewFilters,
): FlowEdge[] {
	return graph.edges.filter((edge) => {
		if (filters.movement !== "all" && edge.movement !== filters.movement)
			return false;
		if (
			filters.accountId !== null &&
			edge.from !== filters.accountId &&
			edge.to !== filters.accountId
		)
			return false;
		return true;
	});
}

export interface AggregatedEdge {
	edge: FlowEdge;
	/** True when this edge groups several small edges (drilldown available). */
	aggregated: boolean;
	/** Edges folded into this group, empty unless aggregated. */
	members: FlowEdge[];
}

// PROVISIONAL grouping threshold (VIS-01 leaves grouping thresholds open):
// edges below this share of the largest visible edge fold into one "other
// flows" group per origin/kind/movement. Change only with that decision.
export const SMALL_EDGE_SHARE = 0.03;

export function aggregateFlowEdges(edges: FlowEdge[]): AggregatedEdge[] {
	if (edges.length === 0) return [];
	const peak = edges.reduce(
		(peak, edge) => Math.max(peak, Math.abs(edge.amount)),
		0,
	);
	if (peak <= 0) {
		return edges.map((edge) => ({ edge, aggregated: false, members: [] }));
	}
	const cutoff = peak * SMALL_EDGE_SHARE;
	const large: AggregatedEdge[] = [];
	const smallByGroup = new Map<string, FlowEdge[]>();
	for (const edge of edges) {
		if (Math.abs(edge.amount) >= cutoff) {
			large.push({ edge, aggregated: false, members: [] });
			continue;
		}
		const key = `${edge.from} ${edge.to} ${edge.kind} ${edge.movement}`;
		const group = smallByGroup.get(key);
		if (group) group.push(edge);
		else smallByGroup.set(key, [edge]);
	}
	const grouped: AggregatedEdge[] = [];
	for (const members of smallByGroup.values()) {
		if (members.length === 1) {
			const only = members[0]!;
			grouped.push({ edge: only, aggregated: false, members: [] });
			continue;
		}
		const first = members[0]!;
		const amount = members.reduce((sum, edge) => sum + edge.amount, 0);
		const sources = members.flatMap((edge) => edge.sources);
		grouped.push({
			edge: { ...first, amount, sources },
			aggregated: true,
			members,
		});
	}
	const byAmount = (left: AggregatedEdge, right: AggregatedEdge) =>
		Math.abs(right.edge.amount) - Math.abs(left.edge.amount);
	large.sort(byAmount);
	grouped.sort(byAmount);
	return [...large, ...grouped];
}

/** Lane identity shared by the layout input, selection state, and the
 * table: route plus position, so a large lane and its same-route
 * small-flow group never share a key. Rebuild the input (and re-resolve
 * selection) whenever the visible lanes change. */
export function sankeyLaneId(
	item: Pick<AggregatedEdge, "edge" | "aggregated">,
	index: number,
): string {
	const edge = item.edge;
	return `${edge.from}|${edge.to}|${edge.kind}|${edge.movement}|${item.aggregated ? "grouped" : "single"}|${index}`;
}

export interface SankeyFlowNode {
	id: string;
	label: string;
	external: boolean;
}

export interface SankeyFlowLane {
	/** Unique lane identity within one built input: route plus the lane
	 * position, so a large edge and its same-route small-flow group never
	 * share a key. Rebuild the input (and re-resolve selection) whenever
	 * the visible lanes change. */
	laneId: string;
	source: string;
	target: string;
	/** Signed realized amount. The layout weighs the absolute value;
	 * labels, the table, and selection keep the sign. */
	amount: number;
	edge: FlowEdge;
	aggregated: boolean;
	members: FlowEdge[];
}

export interface SankeyFlowInput {
	nodes: SankeyFlowNode[];
	lanes: SankeyFlowLane[];
}

const EXTERNAL_IN = `${FLOW_NODE_ID_EXTERNAL}:in`;
const EXTERNAL_OUT = `${FLOW_NODE_ID_EXTERNAL}:out`;

function sankeyEndpoint(id: string, side: "source" | "target"): string {
	if (id !== FLOW_NODE_ID_EXTERNAL) return id;
	return side === "source" ? EXTERNAL_IN : EXTERNAL_OUT;
}

/** Semantic rows for the chart library's flow layout: no renderer state
 * enters this module, so the diagram and the text/table alternative
 * describe the same lanes. The external counterparty splits into a source
 * row and a destination row so one-way money never reads as a loop, and
 * lanes keep their signed amounts while the layout weighs absolute flow.
 * Lanes with non-finite amounts stay out of the layout; the table still
 * lists them exactly. */
export function buildSankeyInput(
	graph: FlowGraph,
	visible: AggregatedEdge[],
): SankeyFlowInput {
	const nodes: SankeyFlowNode[] = [];
	const seen = new Set<string>();
	const nameOf = (id: string): string => {
		if (id === FLOW_NODE_ID_EXTERNAL) return FLOW_EXTERNAL_LABEL;
		return graph.nodes.find((node) => node.id === id)?.name || id;
	};
	const useNode = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		nodes.push({
			id,
			label:
				id === EXTERNAL_IN || id === EXTERNAL_OUT
					? FLOW_EXTERNAL_LABEL
					: nameOf(id),
			external: id === EXTERNAL_IN || id === EXTERNAL_OUT,
		});
	};
	const lanes: SankeyFlowLane[] = [];
	visible.forEach((item, index) => {
		if (!Number.isFinite(item.edge.amount)) return;
		const source = sankeyEndpoint(item.edge.from, "source");
		const target = sankeyEndpoint(item.edge.to, "target");
		if (source === target) return;
		useNode(source);
		useNode(target);
		lanes.push({
			laneId: sankeyLaneId(item, index),
			source,
			target,
			amount: item.edge.amount,
			edge: item.edge,
			aggregated: item.aggregated,
			members: item.members,
		});
	});
	return { nodes, lanes };
}

/** True when the lanes loop back on themselves (A→B and B→A in one
 * window, or a longer chain, possibly fed by other lanes). A one-way flow
 * layout cannot draw a loop, so the page falls back to the table for
 * cyclic windows. Standard three-color depth-first search: fully explored
 * nodes stay marked across start points because a cycle through them
 * would already have been found. */
export function hasFlowCycle(
	lanes: Pick<SankeyFlowLane, "source" | "target">[],
): boolean {
	const outgoing = new Map<string, Set<string>>();
	for (const lane of lanes) {
		if (!outgoing.has(lane.source)) outgoing.set(lane.source, new Set());
		outgoing.get(lane.source)!.add(lane.target);
		if (!outgoing.has(lane.target)) outgoing.set(lane.target, new Set());
	}
	const IN_STACK = 1;
	const DONE = 2;
	const state = new Map<string, number>();
	const reachesBack = (start: string): boolean => {
		const pending: [string, Iterator<string>][] = [
			[start, outgoing.get(start)!.values()],
		];
		state.set(start, IN_STACK);
		while (pending.length > 0) {
			const [node, edges] = pending[pending.length - 1]!;
			const next = edges.next();
			if (next.done) {
				state.set(node, DONE);
				pending.pop();
				continue;
			}
			if (state.get(next.value) === IN_STACK) return true;
			if (!state.has(next.value)) {
				state.set(next.value, IN_STACK);
				pending.push([next.value, outgoing.get(next.value)!.values()]);
			}
		}
		return false;
	};
	for (const node of outgoing.keys()) {
		if (!state.has(node) && reachesBack(node)) return true;
	}
	return false;
}

/** Human sentence for an edge, shared by the diagram label and the table. */
export function describeFlowEdge(
	edge: FlowEdge,
	nameOf: (id: string) => string,
	money: (value: number) => string,
): string {
	const kind =
		edge.kind === "transfer"
			? "Transfer"
			: edge.kind === "inflow"
				? "Money in"
				: "Money out";
	const movement = edge.movement === "actual" ? "recorded" : "planned";
	return `${kind} of ${money(Math.abs(edge.amount))} from ${nameOf(edge.from)} to ${nameOf(edge.to)} (${movement})`;
}

export type { FlowKind };
