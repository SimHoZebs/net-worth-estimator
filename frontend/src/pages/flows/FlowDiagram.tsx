import type { FlowGraph } from "../../api/flows.ts";
import { flowNodeName } from "../../api/flows.ts";
import {
	describeFlowEdge,
	diagramEdgeId,
	type DiagramEdge,
	type FlowDiagram,
} from "../../domain/flowDiagram.ts";
import { money } from "../../domain/format.ts";

const KIND_STROKE: Record<string, string> = {
	inflow: "stroke-chart-series-1",
	transfer: "stroke-chart-series-3",
	outflow: "stroke-chart-series-2",
};

/** Sankey-style diagram: one of several possible renderers over the
 * renderer-independent graph contract. Thickness encodes the amount; every
 * edge is a keyboard-operable button with a text label, and the table view
 * carries the same edges for assistive technology. Color never carries
 * meaning alone: kind also appears in each edge's accessible name. */
export function FlowDiagram({
	graph,
	diagram,
	selectedKey,
	onSelect,
}: {
	graph: FlowGraph;
	diagram: FlowDiagram;
	selectedKey: string | null;
	onSelect: (edge: DiagramEdge | null) => void;
}) {
	const nameOf = (id: string) => flowNodeName(graph, id.replace(/:(in|out)$/, ""));
	return (
		<svg
			viewBox={`0 0 ${diagram.width} ${diagram.height}`}
			role="group"
			aria-label={`Money-flow diagram from ${graph.startDate} through ${graph.endDate}`}
			className="h-auto w-full"
		>
			{diagram.edges.map((item, index) => {
				const key = diagramEdgeId(item, index);
				const active = selectedKey === key;
				const label = describeFlowEdge(item.edge, nameOf, money);
				return (
					<g key={key}>
						<title>{label}</title>
						<path
							d={item.path}
							fill="none"
							strokeWidth={item.thickness}
							strokeLinecap="round"
							className={`${KIND_STROKE[item.edge.kind] ?? "stroke-muted"} opacity-60 transition-opacity hover:opacity-90 ${active ? "opacity-100" : ""}`}
							aria-hidden="true"
						/>
						{/* Wide invisible hit lane keeps thin flows selectable. */}
						<path
							d={item.path}
							fill="none"
							stroke="transparent"
							strokeWidth={Math.max(item.thickness, 16)}
							strokeLinecap="round"
							tabIndex={0}
							role="button"
							aria-pressed={active}
							aria-label={`${label}${item.aggregated ? `, groups ${item.members.length} small flows` : ""}. Activate to inspect its transactions.`}
							onClick={() => onSelect(active ? null : item)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onSelect(active ? null : item);
								}
							}}
							className="cursor-pointer outline-none focus-visible:stroke-chart-median"
						/>
					</g>
				);
			})}
			{diagram.nodes.map((node) => (
				<g key={node.id}>
					<rect
						x={node.x}
						y={node.y}
						width={node.width}
						height={node.height}
						rx={6}
						className="fill-surface-2 stroke-line"
						aria-hidden="true"
					/>
					<text
						x={node.x + 10}
						y={node.y + node.height / 2}
						dominantBaseline="central"
						className="fill-ink text-xs"
						aria-hidden="true"
					>
						{node.name.length > 18
							? `${node.name.slice(0, 17)}…`
							: node.name}
					</text>
				</g>
			))}
		</svg>
	);
}
