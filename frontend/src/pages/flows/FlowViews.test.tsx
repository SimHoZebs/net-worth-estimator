// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { graphFixture } from "../../domain/flowDiagramFixture.ts";
import {
	aggregateFlowEdges,
	layoutFlowDiagram,
} from "../../domain/flowDiagram.ts";
import { FlowDiagram } from "./FlowDiagram.tsx";
import { FlowTable } from "./FlowTable.tsx";

afterEach(cleanup);

function diagramProps() {
	const graph = graphFixture();
	const visible = aggregateFlowEdges(graph.edges);
	return { graph, visible, diagram: layoutFlowDiagram(graph, visible) };
}

describe("FlowDiagram", () => {
	it("renders one selectable edge per visible flow with a text label", () => {
		const { graph, diagram } = diagramProps();
		render(
			<FlowDiagram
				graph={graph}
				diagram={diagram}
				selectedKey={null}
				onSelect={() => {}}
			/>,
		);
		const edges = screen.getAllByRole("button");
		expect(edges).toHaveLength(diagram.edges.length);
		expect(
			screen.getByRole("button", {
				name: /Money in of .* from Outside accounts to Everyday checking \(recorded\)/,
			}),
		).toBeTruthy();
	});

	it("selects an edge on Enter and announces grouped flows", () => {
		const { graph, diagram } = diagramProps();
		const seen: string[] = [];
		render(
			<FlowDiagram
				graph={graph}
				diagram={diagram}
				selectedKey={null}
				onSelect={(item) =>
					seen.push(item ? `${item.edge.from} ${item.edge.to}` : "none")
				}
			/>,
		);
		const grouped = screen.getByRole("button", {
			name: /groups 2 small flows/,
		});
		grouped.focus();
		fireEvent.keyDown(grouped, { key: "Enter" });
		expect(seen).toEqual(["checking savings"]);
	});
});

describe("FlowTable", () => {
	it("lists the same edges with exact amounts and totals", () => {
		const { graph, visible } = diagramProps();
		render(<FlowTable graph={graph} visible={visible} />);
		expect(
			screen.getByRole("table", {
				name: /Money flows from 2026-01-01 through 2026-12-31/,
			}),
		).toBeTruthy();
		expect(screen.getByText(/groups 2 small flows/)).toBeTruthy();
		expect(
			screen.getByRole("table", { name: /Window totals/ }),
		).toBeTruthy();
	});
});
