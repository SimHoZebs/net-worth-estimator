import { describe, expect, it } from "vitest";
import { mergeStyles } from "./mergeStyles.ts";
import {
	badgeStyles,
	progressFillStyles,
	progressTrackStyles,
} from "./uiStyles.ts";

describe("independent feedback recipes", () => {
	it("shares semantic status colors across badges and progress", () => {
		expect(badgeStyles({ tone: "warning" })).toContain("text-warning-text");
		expect(progressFillStyles({ tone: "warning" })).toContain(
			"bg-warning-text",
		);
		expect(progressTrackStyles({ tone: "success" })).toContain("bg-line");
	});
	it("merges semantic radius and shadow overrides", () => {
		expect(
			mergeStyles(
				"rounded-control shadow-overlay",
				"rounded-surface shadow-none",
			),
		).toBe("rounded-surface shadow-none");
	});
});
