import { describe, expect, it } from "vitest";
import { businessLogoURL } from "./businessLogos.ts";

describe("business logo URL resolver", () => {
	it("uses the same-origin catalog path for known keys", () => {
		expect(businessLogoURL("chase")).toBe("/v1/assets/business-logos/chase");
		expect(businessLogoURL("american-express")).toBe(
			"/v1/assets/business-logos/american-express",
		);
	});

	it("returns no URL when no key was recognized", () => {
		expect(businessLogoURL(undefined)).toBeNull();
		expect(businessLogoURL(null)).toBeNull();
		expect(businessLogoURL("")).toBeNull();
	});

	it("never turns metadata into a remote URL or object key", () => {
		const url = businessLogoURL("https://example.com/receipt/secret") as string;
		expect(url.startsWith("/v1/assets/business-logos/")).toBe(true);
		expect(url).not.toContain("//example.com");
		expect(url).not.toContain("/receipt/");
	});
});
