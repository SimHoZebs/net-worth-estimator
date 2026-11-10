import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { runInteractions } from "../mocks/interactions.ts";
import { SegmentedControl } from "./SegmentedControl.tsx";

function Harness() {
	const [value, setValue] = useState<"day" | "week">("day");
	return (
		<SegmentedControl
			ariaLabel="Summary range"
			items={[
				{ value: "day", label: "Day", ariaLabel: "Show daily totals" },
				{ value: "week", label: "Week", ariaLabel: "Show weekly totals" },
			]}
			value={value}
			onChange={setValue}
		/>
	);
}

it("selects a segment and reports the pressed state", async () => {
	render(<Harness />);
	expect(
		screen
			.getByRole("button", { name: "Show daily totals" })
			.getAttribute("aria-pressed"),
	).toBe("true");
	await runInteractions([{ click: ["button", "Show weekly totals"] }]);
	expect(
		screen
			.getByRole("button", { name: "Show weekly totals" })
			.getAttribute("aria-pressed"),
	).toBe("true");
	expect(
		screen
			.getByRole("button", { name: "Show daily totals" })
			.getAttribute("aria-pressed"),
	).toBe("false");
});
