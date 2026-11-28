import { describe, expect, it } from "vitest";
import { horizonDate } from "../domain/result.ts";
import { flowHorizonYears } from "./useFlowGraph.ts";

const cases = [
	["2026-01-02", "2027-01-01", 1],
	["2026-01-02", "2027-01-02", 1],
	["2026-01-02", "2027-01-03", 2],
	["2024-02-29", "2025-02-28", 1],
	["2024-02-29", "2025-03-01", 2],
	["2024-02-29", "2028-02-29", 4],
	["2024-02-29", "2028-03-01", 5],
	["2026-01-31", "2027-01-30", 1],
	["2026-01-31", "2027-01-31", 1],
	["2026-01-31", "2027-02-01", 2],
] as const;

describe("flow projection horizon", () => {
	it.each(cases)(
		"requests %s through %s with the smallest reachable horizon",
		(start, end, years) => {
			expect(flowHorizonYears(start, end)).toBe(years);
			expect(horizonDate({ start, years }) >= end).toBe(true);
		},
	);
	it.each(cases.filter(([, , years]) => years > 1))(
		"does not request an extra year for %s through %s",
		(start, end, years) => {
			expect(horizonDate({ start, years: years - 1 }) < end).toBe(true);
		},
	);
	it("keeps a one-year minimum for empty or reversed windows", () => {
		expect(flowHorizonYears("2026-01-02", "2026-01-02")).toBe(1);
		expect(flowHorizonYears("2026-01-03", "2026-01-02")).toBe(1);
	});
});
