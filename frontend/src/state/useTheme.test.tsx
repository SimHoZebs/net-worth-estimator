import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "./persisted.ts";
import {
	getThemePreference,
	setThemePreference,
	useTheme,
	useThemeSync,
} from "./useTheme.ts";

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

function metaContent(id: string) {
	return document.getElementById(id)?.getAttribute("content");
}

beforeEach(() => {
	addThemeMeta();
	window.localStorage.clear();
	setThemePreference("system");
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
	setThemePreference("system");
	const view = render(<AppTheme />);
	expect(addEventListener).toHaveBeenCalledOnce();
	expect(
		addWindow.mock.calls.filter(([event]) => event === "storage"),
	).toHaveLength(1);
	expect(metaContent("color-scheme")).toBe("light dark");
	act(() => setThemePreference("dark"));
	expect(metaContent("color-scheme")).toBe("dark");
	expect(removeEventListener).toHaveBeenCalledOnce();
	view.unmount();
});

it("follows a stored preference change from another tab", () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	const view = render(<AppTheme />);
	expect(getThemePreference()).toBe("system");
	act(() => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		window.dispatchEvent(
			new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
		);
	});
	expect(getThemePreference()).toBe("dark");
	expect(metaContent("color-scheme")).toBe("dark");
	view.unmount();
});

it("keeps corrupt stored data safe", () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	const view = render(<AppTheme />);
	act(() => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "{bad");
		window.dispatchEvent(
			new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
		);
	});
	expect(getThemePreference()).toBe("system");
	expect(metaContent("color-scheme")).toBe("light dark");
	view.unmount();
});
