import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTheme, useThemeStore, useThemeSync } from "./useTheme.ts";

function addThemeMeta() {
	const colorScheme = document.createElement("meta");
	colorScheme.id = "color-scheme";
	colorScheme.name = "color-scheme";
	colorScheme.content = "light dark";
	const themeColor = document.createElement("meta");
	themeColor.id = "theme-color";
	themeColor.name = "theme-color";
	themeColor.content = "#214c3d";
	document.head.append(colorScheme, themeColor);
}

beforeEach(() => {
	addThemeMeta();
});

afterEach(() => {
	cleanup();
	document.getElementById("color-scheme")?.remove();
	document.getElementById("theme-color")?.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function Control() {
	useTheme();
	return null;
}
function AppTheme() {
	useThemeSync();
	return (
		<>
			<Control />
			<Control />
		</>
	);
}

it("gives multiple controls one application-level listener owner", () => {
	const addEventListener = vi.fn();
	const removeEventListener = vi.fn();
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener,
		removeEventListener,
	}));
	const addWindow = vi.spyOn(window, "addEventListener");
	useThemeStore.setState({ preference: "system" });
	const view = render(<AppTheme />);
	expect(addEventListener).toHaveBeenCalledOnce();
	expect(
		addWindow.mock.calls.filter(([event]) => event === "storage"),
	).toHaveLength(1);
	expect(
		document.getElementById("color-scheme")?.getAttribute("content"),
	).toBe("light dark");
	act(() => useThemeStore.getState().setPreference("dark"));
	expect(
		document.getElementById("color-scheme")?.getAttribute("content"),
	).toBe("dark");
	expect(removeEventListener).toHaveBeenCalledOnce();
	view.unmount();
});
