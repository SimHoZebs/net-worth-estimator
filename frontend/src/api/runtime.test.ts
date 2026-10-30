import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl, getRuntimeConfig } from "./runtime.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("frontend API base configuration", () => {
	it("uses runtime configuration when present", () => {
		vi.stubGlobal("window", {
			__WAYPOINT_CONFIG__: { apiBaseUrl: "https://runtime.example/" },
		});

		expect(getRuntimeConfig()).toEqual({
			apiBaseUrl: "https://runtime.example",
		});
	});

	it("uses the same-origin default when runtime configuration is absent", () => {
		vi.stubGlobal("window", {});

		expect(getRuntimeConfig()).toEqual({ apiBaseUrl: "" });
	});

	it("uses the same-origin default when the value is blank", () => {
		vi.stubGlobal("window", { __WAYPOINT_CONFIG__: { apiBaseUrl: "  " } });

		expect(getApiBaseUrl()).toBe("");
	});

	it("keeps explicit configuration authoritative", () => {
		expect(getApiBaseUrl({ apiBaseUrl: "https://explicit.example/" })).toBe(
			"https://explicit.example",
		);
		expect(getApiBaseUrl("https://explicit.example/")).toBe(
			"https://explicit.example",
		);
	});
});
