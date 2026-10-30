import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { ImportError, parsePlan } from "./storage.ts";

describe("local plan import", () => {
	it("accepts a valid plan document", () => {
		const parsed = parsePlan(JSON.stringify(financialModelFixture));
		expect(parsed).not.toBeInstanceOf(ImportError);
		expect((parsed as { name: string }).name).toBe(financialModelFixture.name);
	});

	it("reports malformed JSON as a recoverable import error", () => {
		expect(parsePlan("{wrong")).toBeInstanceOf(ImportError);
	});

	it("reports a structurally invalid plan rather than accepting it", () => {
		const broken = JSON.stringify({
			...financialModelFixture,
			accounts: "not-an-array",
		});
		expect(parsePlan(broken)).toBeInstanceOf(ImportError);
	});
});
