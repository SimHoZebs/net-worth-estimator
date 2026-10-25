import { describe, expect, it } from "vitest";
import { progressFillStyles, progressTrackStyles } from "./progressStyles.ts";

describe("progress recipe", () => {
	it("exports semantic progress tones", () => {
		expect(progressTrackStyles({ tone: "success" })).toContain("bg-line");
		expect(progressTrackStyles({ tone: "warning" })).toContain("bg-warning-bg");
		expect(progressFillStyles({ tone: "warning" })).toContain(
			"bg-warning-text",
		);
	});
});
