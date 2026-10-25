import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../domain/result.ts";
import { projectionFixture } from "../test/projection.ts";
import { BaseProjectionView } from "./BaseProjectionView.tsx";

const { state } = vi.hoisted(() => ({
	state: {
		base: null as Projection | Error | null,
		loading: false,
		baseError: null as string | null,
		retryProjection: vi.fn(),
	},
}));
vi.mock("../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => state,
}));
afterEach(() => {
	cleanup();
	state.base = null;
	state.loading = false;
	state.baseError = null;
	state.retryProjection.mockClear();
});

function content() {
	return (
		<BaseProjectionView>
			{({ base, current }) => (
				<p>
					{base ? "Result" : "No result"}: {current ? "current" : "pending"}
				</p>
			)}
		</BaseProjectionView>
	);
}

describe("base projection view", () => {
	it("supplies a current successful result", () => {
		state.base = projectionFixture();
		expect(render(content()).getByText("Result: current")).toBeTruthy();
	});
	it("keeps previous evidence but marks it pending during recalculation", () => {
		state.base = projectionFixture();
		state.loading = true;
		expect(render(content()).getByText("Result: pending")).toBeTruthy();
	});
	it("keeps prior content mounted without an inline notice on failure", () => {
		state.base = new Error("Calculation unavailable");
		const view = render(content());
		expect(view.getByText("No result: pending")).toBeTruthy();
		expect(view.queryByText("Calculation unavailable")).toBeNull();
		expect(view.queryByRole("alert")).toBeNull();
	});
	it("does not present prior evidence as current after a failed refresh", () => {
		state.base = projectionFixture();
		state.baseError = "Refresh failed";
		const view = render(content());
		expect(view.queryByText("Refresh failed")).toBeNull();
		expect(view.getByText("Result: pending")).toBeTruthy();
	});
	it("renders the page while its first result is pending", () => {
		state.loading = true;
		expect(render(content()).getByText("No result: pending")).toBeTruthy();
	});
});
