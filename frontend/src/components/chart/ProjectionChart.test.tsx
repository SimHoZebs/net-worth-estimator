import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectionFixture } from "../../mocks/projection.ts";
import { ProjectionChart } from "../ProjectionChart.tsx";
import { useRemoteProjection } from "../../state/useRemoteProjection.ts";
import { useCheckpoints } from "../../state/workspaceResources.ts";

vi.mock("../../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: vi.fn(),
}));

vi.mock("../../state/workspaceResources.ts", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../state/workspaceResources.ts")
	>()),
	useCheckpoints: vi.fn(),
}));

const mockedProjection = vi.mocked(useRemoteProjection);
const mockedCheckpoints = vi.mocked(useCheckpoints);

function mockChart(
	projection: ReturnType<typeof projectionFixture> | null,
	checkpoints: {
		observedAt: number;
		AccountId: string;
		Balance: number;
		source: string;
	}[] = [],
) {
	mockedProjection.mockReturnValue({
		base: projection,
		isPlaceholderData: false,
		status: "success",
		loading: false,
	} as ReturnType<typeof useRemoteProjection>);
	mockedCheckpoints.mockReturnValue({
		data: { checkpoints },
	} as ReturnType<typeof useCheckpoints>);
}

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
	mockChart(
		projectionFixture({
			points: [
				{ date: "2026-06-02", total: 1000, balances: {} },
				{ date: "2026-06-20", total: 1400, balances: {} },
				{ date: "2026-07-01", total: 1800, balances: {} },
			],
		}),
	);
	render(<ProjectionChart onEvidence={onEvidence} />);
	return { onEvidence };
}

describe("projection chart inspection", () => {
	it("keeps the first-sync delta fixed across window changes and inspection", () => {
		mockChart(
			projectionFixture({
				currentNetWorth: 1800,
				points: [
					{ date: "2026-01-01", total: 500, balances: {} },
					{ date: "2026-02-01", total: 1000, balances: {} },
					{ date: "2026-07-01", total: 1800, balances: {} },
					{ date: "2027-01-01", total: 9000, balances: {} },
				],
			}),
			[
				{
					observedAt: Date.parse("2026-02-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1000,
					source: "simplefin",
				},
				{
					observedAt: Date.parse("2026-07-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1800,
					source: "simplefin",
				},
			],
		);
		render(<ProjectionChart onEvidence={vi.fn()} />);
		expect(screen.getByText("+$800 (+80%)")).toBeTruthy();
		expect(screen.getByText("since first sync · Feb 1, 2026")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "90 days" }));
		fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
		expect(screen.getByText("+$800 (+80%)")).toBeTruthy();
		expect(screen.getByText("As of Jul 1, 2026")).toBeTruthy();
	});

	it.each([
		[800, "-$200 (-20%)"],
		[1000, "$0 (0%)"],
	])(
		"shows signed and unchanged deltas for current worth %s",
		(currentNetWorth, label) => {
			mockChart(projectionFixture({ currentNetWorth }), [
				{
					observedAt: Date.parse("2026-01-01T09:00:00Z") / 1000,
					AccountId: "cash",
					Balance: 1000,
					source: "simplefin",
				},
			]);
			render(<ProjectionChart onEvidence={vi.fn()} />);
			expect(screen.getByText(label)).toBeTruthy();
		},
	);

	it("hides the sync comparison until a synced baseline exists", () => {
		show();
		expect(screen.queryByText(/since first sync/)).toBeNull();
	});

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

	it("follows the dot with a badge and crosshair lines", () => {
		show();
		const plot = screen.getByRole("img");
		vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 100, 100),
		);
		// No badge or crosshair before inspection.
		expect(screen.queryByText("Jun 2, 2026")).toBeNull();
		expect(plot.querySelectorAll('line[stroke-dasharray="4 4"]').length).toBe(
			0,
		);
		fireEvent(
			plot,
			new MouseEvent("pointermove", { bubbles: true, clientX: 0 }),
		);
		// Badge tracks the inspected dot with the full date and value.
		expect(screen.getByText("Jun 2, 2026")).toBeTruthy();
		expect(screen.getAllByText("$1,000").length).toBeGreaterThanOrEqual(1);
		// Dotted guides run across both axes through the dot.
		expect(plot.querySelectorAll('line[stroke-dasharray="4 4"]').length).toBe(
			2,
		);
	});

	it("persists the dot on click and toggles off on a second click", () => {
		show();
		const plot = screen.getByRole("img");
		vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 100, 100),
		);
		fireEvent(
			plot,
			new MouseEvent("pointermove", { bubbles: true, clientX: 0 }),
		);
		fireEvent(plot, new MouseEvent("click", { bubbles: true, clientX: 0 }));
		// Leaving keeps the pinned dot, badge, and readout in place.
		fireEvent.pointerLeave(plot);
		const slider = screen.getByRole("slider");
		expect(slider.getAttribute("aria-valuetext")).toBe("Jun 2026: $1,000");
		expect(screen.getByText("Jun 2, 2026")).toBeTruthy();
		expect(plot.querySelectorAll('line[stroke-dasharray="4 4"]').length).toBe(
			2,
		);
		// Clicking the pinned spot again releases it.
		fireEvent(plot, new MouseEvent("click", { bubbles: true, clientX: 0 }));
		fireEvent(
			plot,
			new MouseEvent("pointermove", { bubbles: true, clientX: 99 }),
		);
		fireEvent.pointerLeave(plot);
		expect(slider.getAttribute("aria-valuetext")).toBe("Jul 2026: $1,800");
		expect(screen.queryByText("Jun 2, 2026")).toBeNull();
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
		mockChart(
			projectionFixture({
				points: [
					{ date: "2026-06-10", total: -66200, balances: {} },
					{ date: "2026-07-01", total: -65800, balances: {} },
				],
			}),
		);
		render(<ProjectionChart onEvidence={vi.fn()} />);
		expect(screen.queryByText(/No debt/)).toBeNull();
		expect(
			screen
				.getByRole("slider", { name: "Inspect net worth date" })
				.getAttribute("aria-valuetext"),
		).toBe("Jul 2026: -$65,800");
	});
});
