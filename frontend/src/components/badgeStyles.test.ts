import { describe, expect, it } from "vitest";
import { badgeStyles } from "./badgeStyles.ts";

describe("badge recipe", () => {
	it("exports semantic badge tones", () => {
		expect(badgeStyles({ tone: "neutral" })).toContain("text-muted");
		expect(badgeStyles({ tone: "success" })).toContain("text-success-text");
		expect(badgeStyles({ tone: "warning" })).toContain("text-warning-text");
	});
});
