import { describe, expect, it } from "vitest";
import { mergeStyles } from "./mergeStyles.ts";

describe("mergeStyles", () => {
	it("lets later classes override earlier ones", () => {
		expect(
			mergeStyles(
				"rounded-control shadow-overlay",
				"rounded-surface shadow-none",
			),
		).toBe("rounded-surface shadow-none");
	});
});
