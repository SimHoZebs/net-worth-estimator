import { describe, expect, it } from "vitest";
import { calculateTooltipPosition } from "@/chart/tooltipPosition";

describe("calculateTooltipPosition", () => {
	it("places a rendered tooltip above a cursor in the lower half", () => {
		expect(
			calculateTooltipPosition({
				cursorLeft: 300,
				cursorTop: 350,
				tooltipWidth: 240,
				tooltipHeight: 180,
				containerWidth: 700,
				containerHeight: 420,
			}),
		).toEqual({ left: 312, top: 158 });
	});

	it("places the tooltip below when it does not fit above", () => {
		expect(
			calculateTooltipPosition({
				cursorLeft: 300,
				cursorTop: 50,
				tooltipWidth: 240,
				tooltipHeight: 180,
				containerWidth: 700,
				containerHeight: 420,
			}),
		).toEqual({ left: 312, top: 62 });
	});

	it("keeps the tooltip inside both canvas edges", () => {
		expect(
			calculateTooltipPosition({
				cursorLeft: 680,
				cursorTop: 210,
				tooltipWidth: 240,
				tooltipHeight: 410,
				containerWidth: 700,
				containerHeight: 420,
			}),
		).toEqual({ left: 428, top: 6 });
	});
});
