// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type uPlot from "uplot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPlotChart } from "./UPlotChart";

interface MockChart {
	data: uPlot.AlignedData;
	destroy: ReturnType<typeof vi.fn>;
	setData: ReturnType<typeof vi.fn>;
}

const uPlotState = vi.hoisted(() => ({
	instances: [] as MockChart[],
}));

vi.mock("uplot", () => ({
	default: class {
		data: uPlot.AlignedData;
		cursor = { idx: null, left: null, top: null };
		destroy = vi.fn();
		setSize = vi.fn();
		setData = vi.fn((data: uPlot.AlignedData) => {
			this.data = data;
		});

		constructor(_options: uPlot.Options, data: uPlot.AlignedData) {
			this.data = data;
			uPlotState.instances.push(this);
		}
	},
}));

let animationFrames: Map<number, FrameRequestCallback>;
let nextAnimationFrameId: number;
let now: number;
let reducedMotion: boolean;
let mediaChangeListeners: Set<() => void>;

beforeEach(() => {
	uPlotState.instances.length = 0;
	animationFrames = new Map();
	nextAnimationFrameId = 1;
	now = 0;
	reducedMotion = false;
	mediaChangeListeners = new Set();
	vi.spyOn(performance, "now").mockImplementation(() => now);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			const id = nextAnimationFrameId++;
			animationFrames.set(id, callback);
			return id;
		}),
	);
	vi.stubGlobal(
		"cancelAnimationFrame",
		vi.fn((id: number) => animationFrames.delete(id)),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("matchMedia", () => ({
		get matches() {
			return reducedMotion;
		},
		addEventListener: vi.fn((_event: string, listener: () => void) => {
			mediaChangeListeners.add(listener);
		}),
		removeEventListener: vi.fn((_event: string, listener: () => void) => {
			mediaChangeListeners.delete(listener);
		}),
	}));
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function runNextFrame(timestamp: number) {
	const entry = animationFrames.entries().next().value as
		| [number, FrameRequestCallback]
		| undefined;
	if (!entry) throw new Error("Expected an animation frame");
	animationFrames.delete(entry[0]);
	entry[1](timestamp);
}

describe("UPlotChart data transitions", () => {
	const options = { series: [{}, {}] } as uPlot.Options;
	const transition = { seriesIndexes: [1], durationMs: 200 };

	it("preserves the chart and retargets from the displayed frame", () => {
		const { rerender } = render(
			<UPlotChart
				options={options}
				data={[
					[1, 2],
					[0, 0],
				]}
				dataTransition={transition}
			/>,
		);
		const chart = uPlotState.instances[0];
		expect(animationFrames.size).toBe(0);

		rerender(
			<UPlotChart
				options={options}
				data={[
					[1, 2],
					[100, 100],
				]}
				dataTransition={transition}
			/>,
		);
		expect(uPlotState.instances).toHaveLength(1);
		runNextFrame(100);
		expect(chart.data[1]).toEqual([87.5, 87.5]);

		now = 100;
		rerender(
			<UPlotChart
				options={options}
				data={[
					[1, 2],
					[200, 200],
				]}
				dataTransition={transition}
			/>,
		);
		runNextFrame(200);
		expect(chart.data[1][0]).toBeCloseTo(185.9375);
		expect(uPlotState.instances).toHaveLength(1);
	});

	it("snaps incompatible timestamps and reduced-motion updates", () => {
		const { rerender } = render(
			<UPlotChart
				options={options}
				data={[
					[1, 2],
					[0, 0],
				]}
				dataTransition={transition}
			/>,
		);
		const chart = uPlotState.instances[0];

		rerender(
			<UPlotChart
				options={options}
				data={[
					[1, 3],
					[100, 100],
				]}
				dataTransition={transition}
			/>,
		);
		expect(animationFrames.size).toBe(0);
		expect(chart.data).toEqual([
			[1, 3],
			[100, 100],
		]);

		reducedMotion = true;
		act(() => {
			for (const listener of mediaChangeListeners) listener();
		});
		rerender(
			<UPlotChart
				options={options}
				data={[
					[1, 3],
					[200, 200],
				]}
				dataTransition={transition}
			/>,
		);
		expect(animationFrames.size).toBe(0);
		expect(chart.data[1]).toEqual([200, 200]);
	});

	it("recreates the chart when options change", () => {
		const data = [
			[1, 2],
			[0, 0],
		] as uPlot.AlignedData;
		const { rerender } = render(
			<UPlotChart options={options} data={data} dataTransition={transition} />,
		);
		const firstChart = uPlotState.instances[0];

		rerender(
			<UPlotChart
				options={{ ...options }}
				data={data}
				dataTransition={transition}
			/>,
		);

		expect(firstChart.destroy).toHaveBeenCalledOnce();
		expect(uPlotState.instances).toHaveLength(2);
	});
});
