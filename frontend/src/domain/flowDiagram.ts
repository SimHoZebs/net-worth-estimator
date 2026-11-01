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

export interface DiagramNode {
	id: string;
	name: string;
	external: boolean;
	/** Column: 0 = money sources, 1 = accounts, 2 = money destinations. */
	column: 0 | 1 | 2;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DiagramEdge {
	edge: FlowEdge;
	aggregated: boolean;
	members: FlowEdge[];
	path: string;
	thickness: number;
	fromNode: string;
	toNode: string;
}

export interface FlowDiagram {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	width: number;
	height: number;
}

export interface FlowLayoutOptions {
	width?: number;
	rowHeight?: number;
	nodeWidth?: number;
	maxThickness?: number;
	minThickness?: number;
}

const DEFAULT_WIDTH = 720;
const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_NODE_WIDTH = 132;
const DEFAULT_MAX_THICKNESS = 26;
const DEFAULT_MIN_THICKNESS = 2;

function edgePath(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	bow = 0,
): string {
	const controlX = Math.max((fromX + toX) / 2, fromX + bow, toX + bow);
	return `M ${fromX} ${fromY} C ${controlX} ${fromY}, ${controlX} ${toY}, ${toX} ${toY}`;
}

/** Sankey-style layout derived only from the graph contract: no renderer
 * state enters this module, so the SVG view and the text/table alternative
 * describe the same edges. The external counterparty renders twice — once
 * as the left-hand source of inflows and once as the right-hand
 * destination of outflows — while transfers route between account rows in
 * the middle column. */
export function layoutFlowDiagram(
	graph: FlowGraph,
	visible: AggregatedEdge[],
	options: FlowLayoutOptions = {},
): FlowDiagram {
	const width = options.width ?? DEFAULT_WIDTH;
	const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
	const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
	const maxThickness = options.maxThickness ?? DEFAULT_MAX_THICKNESS;
	const minThickness = options.minThickness ?? DEFAULT_MIN_THICKNESS;

	const nameOf = (id: string): string => {
		if (id === FLOW_NODE_ID_EXTERNAL) return FLOW_EXTERNAL_LABEL;
		return (
			graph.nodes.find((node) => node.id === id)?.name || id
		);
	};
	const accountIds = Array.from(
		new Set(visible.flatMap((item) => [item.edge.from, item.edge.to])),
	).filter((id) => id !== FLOW_NODE_ID_EXTERNAL);
	const accountTotals = new Map<string, number>();
	for (const id of accountIds) accountTotals.set(id, 0);
	for (const item of visible) {
		const amount = Math.abs(item.edge.amount);
		if (item.edge.from !== FLOW_NODE_ID_EXTERNAL) {
			accountTotals.set(
				item.edge.from,
				(accountTotals.get(item.edge.from) ?? 0) + amount,
			);
		}
		if (item.edge.to !== FLOW_NODE_ID_EXTERNAL) {
			accountTotals.set(
				item.edge.to,
				(accountTotals.get(item.edge.to) ?? 0) + amount,
			);
		}
	}
	accountIds.sort(
		(a, b) => (accountTotals.get(b) ?? 0) - (accountTotals.get(a) ?? 0),
	);

	const hasInflow = visible.some(
		(item) => item.edge.from === FLOW_NODE_ID_EXTERNAL,
	);
	const hasOutflow = visible.some(
		(item) => item.edge.to === FLOW_NODE_ID_EXTERNAL,
	);
	const rows = Math.max(accountIds.length, 1);
	const height = rows * rowHeight + rowHeight;
	const middleX = (width - nodeWidth) / 2;
	const nodeY = (index: number) => rowHeight / 2 + index * rowHeight;

	const nodes: DiagramNode[] = [];
	if (hasInflow) {
		nodes.push({
			id: `${FLOW_NODE_ID_EXTERNAL}:in`,
			name: FLOW_EXTERNAL_LABEL,
			external: true,
			column: 0,
			x: 0,
			y: nodeY(0),
			width: nodeWidth,
			height: rowHeight - 12,
		});
	}
	accountIds.forEach((id, index) => {
		nodes.push({
			id,
			name: nameOf(id),
			external: false,
			column: 1,
			x: middleX,
			y: nodeY(index),
			width: nodeWidth,
			height: rowHeight - 12,
		});
	});
	if (hasOutflow) {
		nodes.push({
			id: `${FLOW_NODE_ID_EXTERNAL}:out`,
			name: FLOW_EXTERNAL_LABEL,
			external: true,
			column: 2,
			x: width - nodeWidth,
			y: nodeY(0),
			width: nodeWidth,
			height: rowHeight - 12,
		});
	}

	const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
	const resolveNode = (id: string, side: "from" | "to"): number => {
		if (id !== FLOW_NODE_ID_EXTERNAL) return nodeIndex.get(id) ?? -1;
		const key =
			side === "from"
				? `${FLOW_NODE_ID_EXTERNAL}:in`
				: `${FLOW_NODE_ID_EXTERNAL}:out`;
		if (nodeIndex.has(key)) return nodeIndex.get(key)!;
		// An external leg without its column (filtered away) anchors to the
		// nearest account row instead of vanishing.
		return side === "from" ? 0 : nodes.length - 1;
	};

	const peak = visible.reduce(
		(peak, item) => Math.max(peak, Math.abs(item.edge.amount)),
		0,
	);
	const thicknessOf = (amount: number): number => {
		if (peak <= 0) return minThickness;
		const share = Math.abs(amount) / peak;
		return minThickness + share * (maxThickness - minThickness);
	};

	const laneCursor = new Map<number, number>();
	const laneY = (nodePosition: number): number => {
		const node = nodes[nodePosition];
		if (!node) return 0;
		const used = laneCursor.get(nodePosition) ?? 0;
		laneCursor.set(nodePosition, used + 1);
		// Spread edge lanes across the node face so parallel edges read as
		// separate flows instead of one painted band.
		const lanes = Math.max(
			visible.filter(
				(item) =>
					resolveNode(item.edge.from, "from") === nodePosition ||
					resolveNode(item.edge.to, "to") === nodePosition,
			).length,
			1,
		);
		const slot = node.height / (lanes + 1);
		return node.y + slot * (used + 1);
	};

	const edges: DiagramEdge[] = visible.map((item) => {
		const fromPosition = resolveNode(item.edge.from, "from");
		const toPosition = resolveNode(item.edge.to, "to");
		const fromNode = nodes[fromPosition];
		const toNode = nodes[toPosition];
		const fromX = fromNode ? fromNode.x + fromNode.width : 0;
		// Account-to-account transfers arc along the right side of the
		// middle column so they never cross the inflow/outflow bands.
		const sameColumn =
			fromNode?.column === 1 && toNode?.column === 1;
		const toX = toNode ? (sameColumn ? toNode.x + toNode.width + 8 : toNode.x) : width;
		const fromY = laneY(fromPosition);
		const toY = laneY(toPosition);
		// Same-column transfers bow rightward proportionally to the row
		// gap so parallel transfers read as separate arcs, not one line.
		const bow = sameColumn
			? Math.min(Math.max(Math.abs(toY - fromY) * 0.75, 24), 120)
			: 0;
		const path = edgePath(fromX, fromY, toX, toY, bow);
		return {
			edge: item.edge,
			aggregated: item.aggregated,
			members: item.members,
			path,
			thickness: thicknessOf(item.edge.amount),
			fromNode: fromNode?.id ?? item.edge.from,
			toNode: toNode?.id ?? item.edge.to,
		};
	});

	return { nodes, edges, width, height };
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

/** Stable identity for one rendered edge lane. Route alone is not unique:
 * a large edge and a grouped small-flow edge can share from/to/kind/
 * movement, so the lane index within the sorted visible list disambiguates.
 * The diagram, the selection state, and the table must all use this. */
export function diagramEdgeId(
	item: Pick<AggregatedEdge, "edge" | "aggregated">,
	index: number,
): string {
	const edge = item.edge;
	return `${edge.from} ${edge.to} ${edge.kind} ${edge.movement} ${item.aggregated ? "grouped" : "single"} ${index}`;
}
