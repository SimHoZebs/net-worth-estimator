import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runInteractions } from "../mocks/interactions.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import { setThemePreference } from "../state/useTheme.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

beforeEach(() => {
	stubMatchMedia(false);
	setThemePreference("system");
});

afterEach(() => {
	cleanup();
	setThemePreference("system");
});

it("cycles system, light, dark, and back to system", async () => {
	render(<ThemeToggle />);
	const label = () =>
		screen.getByRole("button", { name: /Theme:/ }).getAttribute("aria-label");
	expect(label()).toContain("System");
	await runInteractions([{ click: ["button", /Theme: System/] }]);
	expect(label()).toContain("Light");
	await runInteractions([{ click: ["button", /Theme: Light/] }]);
	expect(label()).toContain("Dark");
	await runInteractions([{ click: ["button", /Theme: Dark/] }]);
	expect(label()).toContain("System");
});
