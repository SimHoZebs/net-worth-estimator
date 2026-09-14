import { describe, expect, it } from "vitest";
import { validatePostingFulfillmentConfig } from "../evaluation/postingFulfillment";

describe("posting fulfillment configuration", () => {
	it("validates config", () => {
		expect(validatePostingFulfillmentConfig({})).toEqual({ postingIds: null });
		expect(() =>
			validatePostingFulfillmentConfig({ postingIds: [""] }),
		).toThrow(/postingIds/u);
	});
});
