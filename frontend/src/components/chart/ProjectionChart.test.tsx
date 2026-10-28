import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Sparse engine rows inside the trailing window expand into one daily point
// per day: 2026-06-02 holds $1,000 through 2026-06-19, $1,400 from 2026-06-20,
// and $1,800 on 2026-07-01.
function show() {
	const onEvidence = vi.fn();
	render(
		<ProjectionChart
			projection={projectionFixture({
				points: [
					{ date: "2026-06-02", total: 1000, balances: {} },
					{ date: "2026-06-20", total: 1400, balances: {} },
					{ date: "2026-07-01", total: 1800, balances: {} },
				],
			})}
			onEvidence={onEvidence}
		/>,
	);
	return { onEvidence };
}

describe("projection chart inspection", () => {
	it("keeps keyboard inspection values and resets on blur", () => {
		show();
		const slider = screen.getByRole("slider", {
			name: "Inspect net worth date",
		});
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
		fireEvent.change(slider, { target: { value: "0" } });
		expect(slider.getAttribute("aria-valuetext")).toBe("Jun 2026: $1,000");
		fireEvent.change(slider, { target: { value: "18" } });
		expect(slider.getAttribute("aria-valuetext")).toBe("Jun 2026: $1,400");
		fireEvent.blur(slider);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
	});

	it("keeps pointer inspection", () => {
		show();
		const plot = screen.getByRole("img");
		vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 100, 100),
		);
		fireEvent(
			plot,
			new MouseEvent("pointermove", { bubbles: true, clientX: 0 }),
		);
		const slider = screen.getByRole("slider");
		expect(slider.getAttribute("aria-valuetext")).toBe("Jun 2026: $1,000");
		fireEvent.pointerLeave(plot);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
	});

	it("opens the evidence action from the graph", () => {
		const { onEvidence } = show();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Inspect current net worth evidence",
			}),
		);
		expect(onEvidence).toHaveBeenCalledOnce();
	});

	it("switches between 30-day and 90-day windows", () => {
		show();
		const slider = screen.getByRole("slider", {
			name: "Inspect net worth date",
		});
		expect(slider.getAttribute("max")).toBe("29");
		fireEvent.click(screen.getByRole("button", { name: "90 days" }));
		expect(slider.getAttribute("max")).toBe("89");
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
		fireEvent.change(slider, { target: { value: "0" } });
		expect(slider.getAttribute("aria-valuetext")).toBe("Apr 2026: $1,000");
		fireEvent.click(screen.getByRole("button", { name: "30 days" }));
		expect(slider.getAttribute("max")).toBe("29");
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
	});

	it("hides the $0 line for an all-debt window", () => {
		render(
			<ProjectionChart
				projection={projectionFixture({
					points: [
						{ date: "2026-06-10", total: -66200, balances: {} },
						{ date: "2026-07-01", total: -65800, balances: {} },
					],
				})}
				onEvidence={vi.fn()}
			/>,
		);
		expect(screen.queryByText(/No debt/)).toBeNull();
		expect(
			screen
				.getByRole("slider", { name: "Inspect net worth date" })
				.getAttribute("aria-valuetext"),
		).toBe("Jul 2026: -$65,800");
	});
});
