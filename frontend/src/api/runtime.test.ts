import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl, getRuntimeConfig } from "./runtime.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("frontend API base configuration", () => {
	it("prefers runtime configuration over the build-time value", () => {
		vi.stubEnv("VITE_API_BASE_URL", "https://build.example/");
		vi.stubGlobal("window", {
			__WAYPOINT_CONFIG__: { apiBaseUrl: "https://runtime.example/" },
		});

		expect(getRuntimeConfig()).toEqual({
			apiBaseUrl: "https://runtime.example",
		});
	});

	it("uses the build-time value when runtime configuration is absent", () => {
		vi.stubEnv("VITE_API_BASE_URL", "https://build.example///");
		vi.stubGlobal("window", {});

		expect(getRuntimeConfig()).toEqual({ apiBaseUrl: "https://build.example" });
	});

	it("uses the same-origin default when both values are absent or blank", () => {
		vi.stubEnv("VITE_API_BASE_URL", "  ");
		vi.stubGlobal("window", {});

		expect(getApiBaseUrl()).toBe("");
	});

	it("keeps explicit configuration authoritative", () => {
		vi.stubEnv("VITE_API_BASE_URL", "https://build.example");

		expect(getApiBaseUrl({ baseUrl: "https://explicit.example/" })).toBe(
			"https://explicit.example",
		);
	});
});
