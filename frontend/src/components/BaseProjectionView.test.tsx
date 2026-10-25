import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../domain/result.ts";
import { resetNotifications } from "../state/notifications.ts";
import { projectionFixture } from "../test/projection.ts";
import { BaseProjectionView } from "./BaseProjectionView.tsx";
import { NotificationCenter } from "./NotificationCenter.tsx";

const { state } = vi.hoisted(() => ({
	state: {
		base: null as Projection | Error | null,
		loading: false,
		baseError: null as string | null,
		rangeError: null as string | null,
		retryProjection: vi.fn(),
		retryRange: vi.fn(),
	},
}));
vi.mock("../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => state,
}));
afterEach(() => {
	cleanup();
	resetNotifications();
	state.base = null;
	state.loading = false;
	state.baseError = null;
	state.rangeError = null;
	state.retryProjection.mockClear();
	state.retryRange.mockClear();
});

function content() {
	return (
		<>
			<BaseProjectionView>
				{({ base, current }) => (
					<p>
						{base ? "Result" : "No result"}: {current ? "current" : "pending"}
					</p>
				)}
			</BaseProjectionView>
			<NotificationCenter />
		</>
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
	it("exposes calculation failures and a retry action", () => {
		state.base = new Error("Calculation unavailable");
		const view = render(content());
		expect(view.getByText("Calculation unavailable")).toBeTruthy();
		expect(view.getByText("No result: pending")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Retry calculation" }));
		expect(state.retryProjection).toHaveBeenCalledOnce();
	});
	it("does not present prior evidence as current after a failed refresh", () => {
		state.base = projectionFixture();
		state.baseError = "Refresh failed";
		const view = render(content());
		expect(view.getByText("Refresh failed")).toBeTruthy();
		expect(view.getByText("Result: pending")).toBeTruthy();
	});
	it("shows the first request error when no result exists", () => {
		state.baseError = "Initial calculation failed";
		const view = render(content());
		expect(view.getByText("Initial calculation failed")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Retry calculation" }));
		expect(state.retryProjection).toHaveBeenCalledOnce();
	});
	it("stays silent on range errors while ranges are off", () => {
		state.base = projectionFixture();
		state.rangeError = "Scenario failed";
		const view = render(content());
		expect(view.getByText("Result: current")).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Retry scenario calculation" }),
		).toBeNull();
		expect(state.retryRange).not.toHaveBeenCalled();
	});
	it("renders the page while its first result is pending", () => {
		state.loading = true;
		expect(render(content()).getByText("No result: pending")).toBeTruthy();
	});
});
