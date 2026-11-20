import { describe, expect, it } from "vitest";
import { syncedKindError } from "./accountKind.ts";

describe("syncedKindError", () => {
	it("refuses the debt kind on a positive bank balance, but accepts a card credit", () => {
		expect(syncedKindError(4200, "debt")).toMatch(/positive/);
		expect(syncedKindError(20, "credit_card")).toBeNull();
	});
	it("accepts asset kinds on a negative bank balance", () => {
		for (const kind of ["cash", "investment", "property"] as const) {
			expect(syncedKindError(-50, kind)).toBeNull();
		}
	});
	it("accepts debt and credit card on zero and negative balances", () => {
		for (const kind of ["debt", "credit_card"] as const) {
			expect(syncedKindError(0, kind)).toBeNull();
			expect(syncedKindError(-50, kind)).toBeNull();
		}
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
