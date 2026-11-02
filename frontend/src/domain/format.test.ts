import { describe, expect, it } from "vitest";
import { compactMoney, money } from "./format.ts";

describe("money formatting", () => {
	it("keeps the sign outside the symbol for compact negatives", () => {
		expect(compactMoney(-50000)).toBe("-$50k");
		expect(compactMoney(-2500000)).toBe("-$2.50M");
		expect(compactMoney(-5)).toBe(money(-5));
		expect(compactMoney(50000)).toBe("$50k");
		expect(compactMoney(0)).toBe("$0");
	});
});
