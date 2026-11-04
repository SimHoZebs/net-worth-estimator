import { describe, expect, it } from "vitest";
import { merchantNamesMatch } from "./merchantName.ts";

describe("merchant name matching", () => {
	it.each([
		["LYFT *TEMP AUTH HOLD", "LYFT *STANDARD 10-30"],
		["Bistro", "Bistro"],
		["The Bistro", "Bistro"],
		["Bistro", "Bistro Uptown"],
		["SQ *Blue Bottle", "Blue Bottle Coffee"],
		["TST* The Bistro", "The Bistro"],
		["PAYPAL *Spotify", "Spotify USA"],
		["Corner Store 1234", "Corner Store 5678"],
		["AMZN MKTP US*2A3B4C5D3", "AMAZON MKTPLACE PMTS AMZN.COM/BILL WA"],
	])("matches %s with %s", (hold, posted) => {
		expect(merchantNamesMatch(hold, posted)).toBe(true);
		expect(merchantNamesMatch(posted, hold)).toBe(true);
	});

	it.each([
		["Bistro Uptown", "Bistro Downtown"],
		["Bistro", "Pizza Place"],
		["", "Bistro"],
		["TEMP AUTH HOLD", "PENDING AUTH"],
	])("rejects %s against %s", (hold, posted) => {
		expect(merchantNamesMatch(hold, posted)).toBe(false);
		expect(merchantNamesMatch(posted, hold)).toBe(false);
	});
});
