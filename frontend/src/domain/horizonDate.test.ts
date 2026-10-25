import { describe, expect, it } from "vitest";
import { horizonDate } from "./result.ts";

// Parity with backend AddYearsClamped (month-end clamping, leap aware).
// The default deterministic range ends here, so any drift silently clips
// the last timeline rows. Expected values verified against the Go
// implementation across month ends and leap days.
describe("horizonDate backend parity", () => {
	const cases: Array<[string, number, string]> = [
		["2026-01-31", 1, "2027-01-31"],
		["2026-01-31", 20, "2046-01-31"],
		["2026-02-28", 10, "2036-02-28"],
		["2024-02-29", 1, "2025-02-28"],
		["2024-02-29", 20, "2044-02-29"],
		["2024-02-29", 30, "2054-02-28"],
		["2026-12-31", 30, "2056-12-31"],
		["2026-06-15", 10, "2036-06-15"],
		["2025-01-01", 1, "2026-01-01"],
		["2026-10-25", 20, "2046-10-25"],
		["2023-02-28", 20, "2043-02-28"],
		["2000-02-29", 1, "2001-02-28"],
		["2000-02-29", 20, "2020-02-29"],
		["2000-02-29", 30, "2030-02-28"],
	];
	for (const [start, years, want] of cases) {
		it(`${start} plus ${years} years is ${want}`, () => {
			expect(horizonDate({ start, years })).toBe(want);
		});
	}
});
