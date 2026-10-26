import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTheme, useThemeStore, useThemeSync } from "./useTheme.ts";

afterEach(() => {
	cleanup();
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
	expect(document.documentElement.dataset.theme).toBe("light");
	act(() => useThemeStore.getState().setPreference("dark"));
	expect(document.documentElement.dataset.theme).toBe("dark");
	expect(removeEventListener).toHaveBeenCalledOnce();
	view.unmount();
});
