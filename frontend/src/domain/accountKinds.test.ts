import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, isLiability } from "./accountKinds.ts";

describe("account kinds", () => {
	it("offers credit card as its own declared kind", () => {
		expect(ACCOUNT_KINDS).toContain("credit_card");
	});

	it("groups debt and credit card as liabilities", () => {
		expect(isLiability({ kind: "debt" })).toBe(true);
		expect(isLiability({ kind: "credit_card" })).toBe(true);
	});

	it("never groups cash as a liability, even when overdrawn", () => {
		for (const kind of ["cash", "investment", "property"] as const) {
			expect(isLiability({ kind })).toBe(false);
		}
	});
});
