// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphFixture } from "../../domain/flowDiagramFixture.ts";
import {
	aggregateFlowEdges,
	buildSankeyInput,
} from "../../domain/flowDiagram.ts";
import { FlowSankey } from "./FlowSankey.tsx";
import { FlowTable } from "./FlowTable.tsx";

afterEach(cleanup);

function inputProps() {
	const graph = graphFixture();
	const visible = aggregateFlowEdges(graph.edges);
	return { graph, visible, input: buildSankeyInput(graph, visible) };
}

describe("FlowSankey", () => {
	it("renders the library flow diagram with its accessible name", () => {
		const { input } = inputProps();
		const onSelectLane = vi.fn();
		render(
			<FlowSankey
				nodes={input.nodes}
				lanes={input.lanes}
				height={320}
				selectedLaneId={null}
				ariaLabel="Money-flow diagram from 2026-01-01 through 2026-12-31"
				ariaDescription="5 money flows."
				onSelectLane={onSelectLane}
				onFocusLane={() => {}}
			/>,
		);
		expect(
			screen.getByRole("img", {
				name: "Money-flow diagram from 2026-01-01 through 2026-12-31",
			}),
		).toBeTruthy();
	});
});

describe("FlowTable", () => {
	it("lists the same edges with exact amounts and totals", () => {
		const { graph, visible } = inputProps();
		render(<FlowTable graph={graph} visible={visible} />);
		expect(
			screen.getByRole("table", {
				name: /Money flows from 2026-01-01 through 2026-12-31/,
			}),
		).toBeTruthy();
		expect(screen.getByText(/groups 2 small flows/)).toBeTruthy();
		expect(screen.getByRole("table", { name: /Window totals/ })).toBeTruthy();
	});
});
