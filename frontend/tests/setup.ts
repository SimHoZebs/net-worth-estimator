import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";

// Tests share one worker and one environment, so every file must leave no DOM,
// storage, timers, route, or module state behind for the next file. The suite
// runs with isolate: false (about 6s for 121 files / 958 tests, against about
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
	if (typeof window !== "undefined" && window.history) {
		// Route state outlives cleanup(): a hash left by one file becomes
		// the next file's initial route and poisons title and navigation
		// assertions. Reset to a blank same-document URL and drop title
		// elements (assigning document.title would create a spare one),
		// since jsdom keeps one history and one document per worker.
		window.history.replaceState(null, "", window.location.pathname);
		document.head.querySelectorAll("title").forEach((element) => {
			element.remove();
		});
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
