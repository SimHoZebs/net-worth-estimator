import {
	defineChart,
	link,
	rect,
	text,
	type ChartCurve,
} from "@tanstack/charts";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import {
	sankeyDiagram,
	type SankeyLink,
	type SankeyNode,
} from "@tanstack/charts/network/sankey";
import { Chart } from "@tanstack/charts/react";
import {
	keyedSelection,
	type KeyedSelectionChange,
} from "@tanstack/charts/selection";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import { toneToken } from "../../components/texture/texture.ts";
import {
	describeLaneTooltip,
	describeNodeTooltip,
	type SankeyFlowLane,
	type SankeyFlowNode,
} from "../../domain/flowDiagram.ts";
import { dateLabel, money } from "../../domain/format.ts";

type FlowSankeyLink = SankeyLink<SankeyFlowNode, SankeyFlowLane, string>;
type FlowSankeyRow =
	| SankeyNode<SankeyFlowNode, SankeyFlowLane, string>
	| FlowSankeyLink;

const KIND_STROKE: Record<SankeyFlowLane["edge"]["kind"], string> = {
	inflow: toneToken("sage"),
	outflow: toneToken("tan"),
	transfer: toneToken("blue"),
};

const KIND_LABEL: Record<SankeyFlowLane["edge"]["kind"], string> = {
	inflow: "Money in",
	outflow: "Money out",
	transfer: "Transfer",
};

// Links stay translucent so overlapping ribbons do not glare; the key
// swatches share the same default paint. Selected links go opaque.
const UNSELECTED_FLOW_OPACITY = 0.65;

const LABEL_LIMIT = 30;
const LABEL_CHAR_WIDTH = 7.6;
const LABEL_BACKGROUND_HEIGHT = 20;
const LABEL_SIDE_GAP = 8;
const LABEL_HALO_PAD = 22;
// One label column, at minimum, so a short name still has breathing room.
const MIN_LABEL_ROOM = 84;
// The plot keeps this much width between its two label columns. Below it,
// ribbons collapse into near-vertical strips and the flow direction stops
// reading, so the chart scrolls sideways instead of squeezing further.
const MIN_CHART_WIDTH = 640;
const MIN_PLOT_WIDTH = 280;

function truncateLabel(label: string): string {
	return label.length > LABEL_LIMIT
		? `${label.slice(0, LABEL_LIMIT - 1)}…`
		: label;
}

/** Side room for the widest painted label: its paper halo plus the gap
 * beside the node bar. The inset and the scroll floor share this value. */
function labelRoomFor(nodes: SankeyFlowNode[]): number {
	const widest = nodes.reduce(
		(widestLabel, node) =>
			Math.max(widestLabel, truncateLabel(node.label).length),
		0,
	);
	return Math.max(
		MIN_LABEL_ROOM,
		Math.ceil(widest * LABEL_CHAR_WIDTH) + LABEL_HALO_PAD + LABEL_SIDE_GAP,
	);
}

/** Horizontal S-curve for flow ribbons. Straight rules fan into crossing
 * diamonds when one source feeds many depths; the mid-x cubic keeps each
 * ribbon horizontal at its endpoints so direction still reads. */
const sankeyCurve: ChartCurve = {
	line: (points) => {
		if (points.length !== 2) return "";
		const start = points[0];
		const end = points[1];
		if (!start || !end) return "";
		const [x1, y1] = start;
		const [x2, y2] = end;
		const midX = (x1 + x2) / 2;
		return `M${x1},${y1}C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
	},
	area: () => "",
};

function labelX(
	node: SankeyNode<SankeyFlowNode, SankeyFlowLane, string>,
): number {
	return node.depth === 0 ? node.x0 - LABEL_SIDE_GAP : node.x1 + LABEL_SIDE_GAP;
}

function labelWidth(label: string): number {
	return (
		Math.ceil(truncateLabel(label).length * LABEL_CHAR_WIDTH) + LABEL_HALO_PAD
	);
}

/** Money-flow diagram on the shared chart setup: the library owns the
 * flow layout, link geometry, keyboard navigation, focus ring, and
 * selection, while the page owns filters, totals, and the inspector. Link
 * width encodes the absolute amount; kind rides in the stroke tone and in
 * the inspector and focused-flow announcements, never color alone. Nodes
 * paint as plain layers beside the selectable flows, and each label rides
 * on a paper halo that shares its node row: hovering the halo shows the
 * same node totals as the bar or the label, while lane hover and selection
 * still resolve in the band middle. A decorative wrapper cannot carry the
 * halo here because Sankey child marks reject post-domain filtering. */
export function FlowSankey({
	nodes,
	lanes,
	height,
	selectedLaneId,
	ariaLabel,
	ariaDescription,
	nameOf,
	onSelectLane,
}: {
	nodes: SankeyFlowNode[];
	lanes: SankeyFlowLane[];
	height: number;
	selectedLaneId: string | null;
	ariaLabel: string;
	ariaDescription: string;
	nameOf: (id: string) => string;
	onSelectLane: (laneId: string | null) => void;
}) {
	const labelRoom = labelRoomFor(nodes);
	const chartMinWidth = Math.max(
		MIN_CHART_WIDTH,
		labelRoom * 2 + MIN_PLOT_WIDTH,
	);
	const definition = useMemo(() => {
		const selection = keyedSelection<FlowSankeyLink, string>({
			selected: controlledSignal<
				string | null,
				KeyedSelectionChange<FlowSankeyLink, string>
			>(selectedLaneId, (next) => {
				onSelectLane(next === selectedLaneId ? null : next);
			}),
			key: (datum) => datum.data.laneId,
		});
		return defineChart(
			{
				marks: [
					sankeyDiagram({
						nodes,
						links: lanes,
						nodeKey: "id",
						source: "source",
						target: "target",
						value: (lane) => Math.abs(lane.amount),
						linkKey: "laneId",
						align: "justify",
						iterations: 32,
						nodeWidth: ({ width }) => Math.max(10, Math.min(20, width * 0.028)),
						// Fixed gaps pack tiny nodes until their labels collide, so
						// the gap grows with chart height on dense graphs while a
						// sparse graph keeps its compact rows.
						nodePadding: ({ height }) =>
							Math.max(12, Math.min(32, height * 0.08)),
						inset: ({ width }) => {
							const maxSide = Math.max(72, Math.floor((width - 120) / 2));
							const side = Math.min(labelRoom, maxSide);
							return { left: side, right: side, top: 10, bottom: 10 };
						},
						marks: ({ nodes: layoutNodes, links: layoutLinks }) =>
							[
								link(layoutLinks, {
									x1: "x1",
									y1: "y1",
									x2: "x2",
									y2: "y2",
									key: "key",
									stroke: (flow) => KIND_STROKE[flow.data.edge.kind],
									strokeOpacity: (flow) =>
										selectedLaneId === null
											? UNSELECTED_FLOW_OPACITY
											: flow.data.laneId === selectedLaneId
												? 1
												: 0.35,
									strokeWidth: (flow) => Math.max(1, flow.width),
									lineCap: "butt",
									curve: sankeyCurve,
								}),
								rect(layoutNodes, {
									x1: "x0",
									x2: "x1",
									y1: "y0",
									y2: "y1",
									key: "key",
									fill: "var(--ink)",
									inset: 0,
								}),
								rect(layoutNodes, {
									x1: (node) =>
										labelX(node) -
										(node.depth === 0 ? labelWidth(node.data.label) : 6),
									x2: (node) =>
										labelX(node) +
										(node.depth === 0 ? 6 : labelWidth(node.data.label)),
									y1: (node) => node.y - LABEL_BACKGROUND_HEIGHT / 2,
									y2: (node) => node.y + LABEL_BACKGROUND_HEIGHT / 2,
									key: (node) => `${node.key}-label`,
									fill: "var(--paper)",
									fillOpacity: 0.9,
									inset: 0,
								}),
								text(layoutNodes, {
									x: labelX,
									y: (node) => node.y,
									text: (node) => truncateLabel(node.data.label),
									key: "key",
									anchor: (node) => (node.depth === 0 ? "end" : "start"),
									fill: "var(--ink)",
									fontSize: 12,
									fontWeight: 600,
								}),
							] as const,
					}),
				],
				scales: {
					x: null,
					y: null,
				},
				guides: false,
				margin: 0,
				selection,
				tooltip: {
					use: tooltip,
					format: (point) => {
						const datum = point.datum as FlowSankeyRow;
						if (datum.kind === "link") {
							return describeLaneTooltip(
								datum.data.edge,
								nameOf,
								money,
								dateLabel,
							);
						}
						return describeNodeTooltip(
							datum.data.label,
							datum.incomingLinks.map((item) => item.data.amount),
							datum.outgoingLinks.map((item) => item.data.amount),
							money,
						);
					},
				},
			},
			{ keyboard: true },
		);
	}, [nodes, lanes, labelRoom, selectedLaneId, nameOf, onSelectLane]);
	return (
		<div className="grid gap-2">
			{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the diagram. */}
			<div
				className="overflow-x-auto"
				role="region"
				aria-label="Scrollable money-flow diagram"
				tabIndex={0}
			>
				<div style={{ minWidth: chartMinWidth }}>
					<Chart
						definition={definition}
						ariaLabel={ariaLabel}
						ariaDescription={ariaDescription}
						height={height}
					/>
				</div>
			</div>
			{/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
			<p className="text-xs text-muted sm:hidden">
				Scroll sideways to see the whole diagram.
			</p>
			{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled flex lists. */}
			<ul
				className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-xs text-muted"
				role="list"
				aria-label="Flow key"
			>
				{(Object.keys(KIND_STROKE) as Array<keyof typeof KIND_STROKE>).map(
					(kind) => (
						<li key={kind} className="flex items-center gap-2">
							<span
								aria-hidden="true"
								className="block h-1 w-7"
								style={{
									backgroundColor: KIND_STROKE[kind],
									opacity: UNSELECTED_FLOW_OPACITY,
								}}
							/>
							{KIND_LABEL[kind]}
						</li>
					),
				)}
				<li>Width shows the absolute amount.</li>
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
		</div>
	);
}
