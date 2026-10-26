import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { projectionFixture } from "../../mocks/projection.ts";
import { ProjectionChart } from "../ProjectionChart.tsx";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function show() {
	const setYears = vi.fn();
	const setRanges = vi.fn();
	render(
		<ProjectionChart
			plan={testPlan}
			projection={projectionFixture()}
			range={null}
			ranges={false}
			setRanges={setRanges}
			years={10}
			setYears={setYears}
			progress={0}
			rangeError={null}
		/>,
	);
	return { setYears, setRanges };
}

describe("projection chart inspection", () => {
	it("keeps keyboard inspection values and resets on blur", () => {
		show();
		const slider = screen.getByRole("slider", {
			name: "Inspect projection date",
		});
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,400");
		fireEvent.change(slider, { target: { value: "2" } });
		expect(slider.getAttribute("aria-valuetext")).toBe("Jan 2027: $1,800");
		fireEvent.blur(slider);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,400");
	});

	it("keeps pointer inspection, horizon changes, and the range switch", () => {
		const { setYears, setRanges } = show();
		const plot = screen.getByRole("img");
		vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 100, 100),
		);
		fireEvent(
			plot,
			new MouseEvent("pointermove", { bubbles: true, clientX: 0 }),
		);
		const slider = screen.getByRole("slider");
		expect(slider.getAttribute("aria-valuetext")).toBe("Jan 2026: $1,000");
		fireEvent.pointerLeave(plot);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,400");
		fireEvent.change(slider, { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: "20 years" }));
		expect(setYears).toHaveBeenCalledWith(20);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,400");
		fireEvent.click(screen.getByRole("switch", { name: "Show range" }));
		expect(setRanges).toHaveBeenCalledWith(true);
	});
});
