import { afterEach, vi } from "vitest";

afterEach(async () => {
	if (typeof document !== "undefined") {
		const { cleanup } = await import("@testing-library/react");
		cleanup();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
