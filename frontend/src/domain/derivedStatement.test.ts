import { describe, expect, it } from "vitest";
import { derivedStatementStatus } from "./derivedStatement.ts";
import { statementStatusLabel } from "./statementPayment.ts";

describe("derived statement status", () => {
	it("treats a full remaining balance with no allocation as open", () => {
		expect(
			derivedStatementStatus({
				billedAmount: 125.55,
				remaining: 125.55,
				allocated: 0,
			}),
		).toBe("open");
	});

	it("reports a partly settled statement as partially paid", () => {
		expect(
			derivedStatementStatus({
				billedAmount: 1000,
				remaining: 275.55,
				allocated: 724.45,
			}),
		).toBe("partially-paid");
	});

	it("reports a zero remaining balance as paid in full", () => {
		expect(
			derivedStatementStatus({
				billedAmount: 1000,
				remaining: 0,
				allocated: 1000,
			}),
		).toBe("paid-in-full");
	});

	it("never treats a missing amount as zero", () => {
		for (const missing of ["billedAmount", "remaining", "allocated"] as const) {
			expect(
				derivedStatementStatus({
					billedAmount: 1000,
					remaining: 1000,
					allocated: 0,
					[missing]: null,
				}),
			).toBe("unknown");
		}
		expect(statementStatusLabel("unknown")).toBe("Status unknown");
	});
});
