import { describe, expect, it } from "vitest";
import { buildApiUrl } from "./api-url";

describe("buildApiUrl", () => {
	it("preserves same-origin paths when no base URL is configured", () => {
		expect(buildApiUrl("/v1/financial-model", undefined)).toBe(
			"/v1/financial-model",
		);
		expect(buildApiUrl("/v1/financial-model", "   ")).toBe(
			"/v1/financial-model",
		);
	});

	it("joins an absolute API URL without duplicate slashes", () => {
		expect(
			buildApiUrl("/v1/financial-model", " https://api.example.com/// "),
		).toBe("https://api.example.com/v1/financial-model");
	});

	it("preserves a configured path prefix", () => {
		expect(buildApiUrl("/v1/income-data", "/backend/")).toBe(
			"/backend/v1/income-data",
		);
	});
});
