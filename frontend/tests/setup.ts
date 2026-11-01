import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";

// Tests share one worker and one environment, so every file must leave no DOM,
// storage, timers, or module state behind for the next file. The suite runs
// with isolate: false (about 6s for 121 files / 958 tests, against about 32s
// isolated), and these hooks are the contract that makes that safe.
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
	vi.useRealTimers();
});

// Module singletons (stores, counters, fetch mocks) survive between files.
// Drop the module graph after each file so the next file imports fresh state.
afterAll(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetModules();
});
