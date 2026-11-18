import { describe, expect, it } from "vitest";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";

describe("backend API contracts", () => {
	it("exposes finite account-bound sentinels for wire compatibility", () => {
		expect(NO_FLOOR_SENTINEL).toBe(-10_000_000_000_000);
		expect(NO_CEILING_SENTINEL).toBe(10_000_000_000_000);
	});
});
