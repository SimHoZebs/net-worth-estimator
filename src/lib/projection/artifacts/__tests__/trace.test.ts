// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { projectionCacheErrorDetails, traceProjectionCache } from "../trace";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("traceProjectionCache", () => {
	it("logs cache events", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		traceProjectionCache("cache-event", { key: "test-key" });

		expect(log).toHaveBeenCalledWith("[projection-cache] cache-event", {
			key: "test-key",
		});
	});

	it("does not allow console failures to affect callers", () => {
		vi.spyOn(console, "log").mockImplementation(() => {
			throw new Error("console unavailable");
		});

		expect(() => traceProjectionCache("console-failure")).not.toThrow();
	});

	it("does not include potentially sensitive error messages", () => {
		const error = {
			toString: () => {
				throw new Error("conversion failed");
			},
		};

		expect(projectionCacheErrorDetails(error)).toEqual({
			errorName: "object",
		});
		expect(projectionCacheErrorDetails(new Error("account-private"))).toEqual({
			errorName: "Error",
		});
	});
});
