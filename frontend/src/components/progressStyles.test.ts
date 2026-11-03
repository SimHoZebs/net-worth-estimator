import { describe, expect, it } from "vitest";
import { progressStyles } from "./progressStyles.ts";

describe("progress recipe", () => {
	it("exports semantic progress tones", () => {
		expect(progressStyles({ tone: "success" })).toContain("bg-line");
		expect(progressStyles({ tone: "warning" })).toContain("bg-warning-bg");
		expect(progressStyles({ tone: "warning" })).toContain("bg-warning-text");
	});
});
