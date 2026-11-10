import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { runInteractions } from "../mocks/interactions.ts";
import { Tabs, type TabItem } from "./Tabs.tsx";

type Section = "one" | "two" | "three";
const items: TabItem<Section>[] = [
	{ id: "one", label: "One" },
	{ id: "two", label: "Two" },
	{ id: "three", label: "Three" },
];

function Harness() {
	const [value, setValue] = useState<Section>("one");
	return (
		<Tabs
			label="Example sections"
			items={items}
			value={value}
			onChange={setValue}
		>
			<p>Panel {value}</p>
		</Tabs>
	);
}

describe("tab interactions", () => {
	it("selects on click and exposes the selected state", async () => {
		render(<Harness />);
		expect(screen.getByText("Panel one")).toBeTruthy();
		await runInteractions([{ click: ["tab", "Two"] }]);
		expect(screen.getByText("Panel two")).toBeTruthy();
		expect(
			screen.getByRole("tab", { name: "Two" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(
			screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected"),
		).toBe("false");
	});

	it("moves selection and focus with arrow keys", async () => {
		render(<Harness />);
		screen.getByRole("tab", { name: "One" }).focus();
		await runInteractions([{ press: "{ArrowRight}" }]);
		expect(
			screen.getByRole("tab", { name: "Two" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(document.activeElement).toBe(
			screen.getByRole("tab", { name: "Two" }),
		);
		await runInteractions([{ press: "{ArrowLeft}" }]);
		expect(
			screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(document.activeElement).toBe(
			screen.getByRole("tab", { name: "One" }),
		);
	});

	it("wraps arrow navigation and supports Home and End", async () => {
		render(<Harness />);
		screen.getByRole("tab", { name: "One" }).focus();
		await runInteractions([{ press: "{ArrowLeft}" }]);
		expect(
			screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected"),
		).toBe("true");
		await runInteractions([{ press: "{Home}" }]);
		expect(
			screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected"),
		).toBe("true");
		await runInteractions([{ press: "{End}" }]);
		expect(
			screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected"),
		).toBe("true");
	});

	it("keeps one tab stop on the selected tab", () => {
		render(<Harness />);
		for (const tab of screen.getAllByRole("tab")) {
			const selected = tab.getAttribute("aria-selected") === "true";
			expect(tab.getAttribute("tabindex")).toBe(selected ? "0" : "-1");
		}
	});
});
