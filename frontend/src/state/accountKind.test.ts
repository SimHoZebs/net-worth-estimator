import { describe, expect, it } from "vitest";
import { syncedKindError } from "./accountKind.ts";

describe("syncedKindError", () => {
	it("refuses debt on a positive bank balance", () => {
		expect(syncedKindError(4200, "debt")).toMatch(/positive/);
	});
	it("refuses assets on a negative bank balance", () => {
		for (const kind of ["cash", "investment", "property"] as const) {
			expect(syncedKindError(-50, kind)).toMatch(/negative/);
		}
	});
	it("accepts debt on zero and negative balances", () => {
		expect(syncedKindError(0, "debt")).toBeNull();
		expect(syncedKindError(-50, "debt")).toBeNull();
	});
	it("accepts assets on zero and positive balances", () => {
		for (const kind of ["cash", "investment", "property"] as const) {
			expect(syncedKindError(0, kind)).toBeNull();
			expect(syncedKindError(100, kind)).toBeNull();
		}
	});
	it("asks for a balance when none is known", () => {
		expect(syncedKindError(null, "debt")).toMatch(/balance/i);
	});
});
