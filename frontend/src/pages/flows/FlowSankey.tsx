import { defineChart, link, rect, text } from "@tanstack/charts";
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

const LABEL_LIMIT = 18;

function truncateLabel(label: string): string {
	return label.length > LABEL_LIMIT
		? `${label.slice(0, LABEL_LIMIT - 1)}…`
		: label;
}

/** Money-flow diagram on the shared chart setup: the library owns the
 * flow layout, link geometry, keyboard navigation, focus ring, and
 * selection, while the page owns filters, totals, and the inspector. Link
 * width encodes the absolute amount; kind rides in the stroke tone and in
 * the inspector and focused-flow announcements, never color alone. Nodes
 * paint as plain layers beside the selectable flows. */
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
						nodeSort: null,
						linkSort: null,
						nodeWidth: ({ width }) => Math.max(10, Math.min(20, width * 0.028)),
						nodePadding: 12,
						inset: ({ width }) => {
							const side = Math.min(132, Math.max(72, width * 0.18));
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
										selectedLaneId === null ||
										flow.data.laneId === selectedLaneId
											? 1
											: 0.35,
									strokeWidth: (flow) => Math.max(2, flow.width),
									lineCap: "butt",
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
								text(layoutNodes, {
									x: (node) => (node.depth === 0 ? node.x0 - 8 : node.x1 + 8),
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
	}, [nodes, lanes, selectedLaneId, nameOf, onSelectLane]);
	return (
		<Chart
			definition={definition}
			ariaLabel={ariaLabel}
			ariaDescription={ariaDescription}
			height={height}
		/>
	);
}
