import { describe, expect, it } from "vitest";
import { testPlan } from "../test/plan.ts";
import { ImportError, parsePlan } from "./storage.ts";

describe("local plan import", () => {
	it("accepts a valid plan document", () => {
		const parsed = parsePlan(JSON.stringify(testPlan));
		expect(parsed).not.toBeInstanceOf(ImportError);
		expect((parsed as { name: string }).name).toBe(testPlan.name);
	});

	it("reports malformed JSON as a recoverable import error", () => {
		expect(parsePlan("{wrong")).toBeInstanceOf(ImportError);
	});

	it("reports a structurally invalid plan rather than accepting it", () => {
		const broken = JSON.stringify({ ...testPlan, accounts: "not-an-array" });
		expect(parsePlan(broken)).toBeInstanceOf(ImportError);
	});
});
