// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { graphFixture } from "../../domain/flowDiagramFixture.ts";
import {
	aggregateFlowEdges,
	buildSankeyInput,
} from "../../domain/flowDiagram.ts";
import { FlowSankey } from "./FlowSankey.tsx";
import { FlowTable } from "./FlowTable.tsx";

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
				nameOf={(id) => id}
			/>,
		);
		expect(
			screen.getByRole("img", {
				name: "Money-flow diagram from 2026-01-01 through 2026-12-31",
			}),
		).toBeTruthy();
		expect(screen.getByRole("list", { name: "Flow key" })).toBeTruthy();
		expect(screen.getByText("Money in")).toBeTruthy();
		expect(screen.getByText("Money out")).toBeTruthy();
		expect(screen.getByText("Transfer")).toBeTruthy();
		expect(screen.getByText("Width shows the absolute amount.")).toBeTruthy();
	});

	it("keeps a readable scroll floor around the diagram", () => {
		const { input } = inputProps();
		render(
			<FlowSankey
				nodes={input.nodes}
				lanes={input.lanes}
				height={320}
				selectedLaneId={null}
				ariaLabel="Money-flow diagram from 2026-01-01 through 2026-12-31"
				ariaDescription="5 money flows."
				onSelectLane={vi.fn()}
				nameOf={(id) => id}
			/>,
		);
		const region = screen.getByRole("region", {
			name: "Scrollable money-flow diagram",
		});
		expect(region.tabIndex).toBe(0);
		expect(region.classList.contains("overflow-x-auto")).toBe(true);
		const minWidth = Number.parseFloat(
			(region.firstElementChild as HTMLElement | null)?.style.minWidth ?? "",
		);
		expect(minWidth).toBeGreaterThanOrEqual(320);
		expect(
			screen.getByText("Scroll sideways to see the whole diagram."),
		).toBeTruthy();
	});

	it("widens the scroll floor to fit long node labels", () => {
		const { input } = inputProps();
		const { rerender } = render(
			<FlowSankey
				nodes={input.nodes}
				lanes={input.lanes}
				height={320}
				selectedLaneId={null}
				ariaLabel="Fixture money-flow diagram"
				ariaDescription="5 money flows."
				onSelectLane={vi.fn()}
				nameOf={(id) => id}
			/>,
		);
		const region = screen.getByRole("region", {
			name: "Scrollable money-flow diagram",
		});
		const fixtureFloor = Number.parseFloat(
			(region.firstElementChild as HTMLElement | null)?.style.minWidth ?? "",
		);
		const label = "A".repeat(40);
		rerender(
			<FlowSankey
				nodes={input.nodes.map((node) => ({ ...node, label }))}
				lanes={input.lanes}
				height={320}
				selectedLaneId={null}
				ariaLabel="Long-label money-flow diagram"
				ariaDescription="5 money flows."
				onSelectLane={vi.fn()}
				nameOf={(id) => id}
			/>,
		);
		const longFloor = Number.parseFloat(
			(region.firstElementChild as HTMLElement | null)?.style.minWidth ?? "",
		);
		expect(longFloor).toBeGreaterThan(fixtureFloor);
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
