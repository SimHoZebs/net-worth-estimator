import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SegmentedBar, type BarSegment } from "../SegmentedBar.tsx";

afterEach(cleanup);

const segments: BarSegment[] = [
	{ label: "Available", amount: 75, pattern: "solid", tone: "sage" },
	{ label: "Missing", amount: 25, pattern: "hatch", tone: "tan" },
	{ label: "Reserve", amount: 0, pattern: "dots", tone: "blue" },
];

describe("segmented bar ownership", () => {
	it("keeps its caption, accessible summary, and texture meaning", () => {
		render(
			<SegmentedBar
				caption="Available $75 of $100 required"
				ariaLabel="75 percent covered, $25 short"
				segments={segments}
				className="mt-0.5"
				captionClassName="text-xs text-muted"
			/>,
		);
		const caption = screen.getByText("Available $75 of $100 required");
		expect(caption.className).toContain("text-xs");
		expect(caption.className).not.toContain("text-sm");
		expect(caption.parentElement?.className).toContain("mt-0.5");
		const bar = screen.getByRole("img", {
			name: "75 percent covered, $25 short",
		});
		expect(bar.children).toHaveLength(2);
		expect(bar.children[0]?.getAttribute("data-tone")).toBe("sage");
		expect(bar.children[0]?.getAttribute("style")).toContain("75%");
		expect(bar.children[1]?.getAttribute("data-pattern")).toBe("hatch");
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
	});

	it("hides visible details without dropping its accessible summary", () => {
		render(
			<SegmentedBar
				caption="Allocation"
				ariaLabel="Allocation summary"
				segments={segments}
				showDetails={false}
			/>,
		);
		expect(screen.queryByText("Allocation")).toBeNull();
		expect(screen.queryByRole("list")).toBeNull();
		expect(
			screen.getByRole("img", { name: "Allocation summary" }),
		).toBeTruthy();
	});
});
