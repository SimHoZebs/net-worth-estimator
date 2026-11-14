import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";
import { resetServerQueryCache } from "../src/state/serverQuery.ts";

// jsdom has no matchMedia. Sonner's Toaster reads it in a passive-mount
// effect, so every tree that mounts the Toaster crashes without a stub.
// Install unconditionally (the per-test reinstall in afterEach keeps it
// alive across files; files with their own stub keep overriding per test).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: (query: string) => ({
			matches: /prefers-reduced-motion:\s*reduce/.test(query),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}
// jsdom has no dialog API. Stub only the open-state toggle: top layer, focus
// containment, Escape, and focus return are browser behavior covered by the
// browser suite.
if (
	typeof HTMLDialogElement !== "undefined" &&
	!HTMLDialogElement.prototype.showModal
) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute("open");
	};
}

// Tests share one worker and one environment, so every file must leave no DOM,
// storage, timers, route, or module state behind for the next file. The suite
// runs with isolate: false (about 6s for the retained safety tier, against about
// 32s isolated), and these hooks are the contract that makes that safe.
// Window singletons such as __WAYPOINT_CONFIG__ stay per-file discipline:
// set them in the file's own beforeEach and clear them in its afterEach, so
// no test depends on another test's globals.
afterEach(() => {
	if (typeof document !== "undefined") {
		cleanup();
		document.body.innerHTML = "";
	}
	if (typeof localStorage !== "undefined") localStorage.clear();
	if (typeof sessionStorage !== "undefined") sessionStorage.clear();
	// The query client is a module singleton, so cached server state (and
	// the scope it was fetched under) outlives the file that filled it.
	// Individual files already clear it; clearing here makes the contract
	// unconditional instead of depending on every file remembering.
	resetServerQueryCache();
	if (typeof window !== "undefined" && window.history) {
		// Route state outlives cleanup(): a page or overlay URL left by
		// one file becomes the next file's initial route and poisons
		// title and navigation assertions. Reset to the root same-document
		// URL and drop title elements (assigning document.title would
		// create a spare one), since jsdom keeps one history and one
		// document per worker.
		window.history.replaceState(null, "", "/");
		document.head.querySelectorAll("title").forEach((element) => {
			element.remove();
		});
	}
	if (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function"
	) {
		// Motion-driven exit animations outlive their test file and fire
		// navigation callbacks in the next file. Reduced motion collapses
		// them, so closes settle inside the test that started them.
		// Viewport queries keep jsdom's no-match behavior; files with
		// their own matchMedia stub keep overriding per test.
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: /prefers-reduced-motion:\s*reduce/.test(query),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}));
	}
	vi.useRealTimers();
});

// Module singletons (stores, counters, fetch mocks) survive between files.
// Drop the module graph after each file so the next file imports fresh state.
afterAll(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetModules();
});
